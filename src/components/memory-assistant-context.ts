import { memoryPrivacyMutationActive } from '../state/memory-privacy-mutation.ts';
import { html, nothing } from 'lit';
import { FormaElement } from './forma-element.ts';
import { createAssistantMemoryContextClient, type AssistantMemoryContextView } from '../state/memory-assistant-context-client.ts';
import { parseMemoryCustody } from '../model/memory-custody.ts';
import { createMemoryElapsed } from '../model/memory-lifetime.ts';
import { personalMemoryMessage } from './design-system/locales/personal-memory-messages.ts';
import './document-memory-brief.css';

type Owner={controller:AbortController;current:()=>boolean;scope:{projectId:string;documentId:string}};
/** Private reference-only assistant context. Choosing a note neither sends a
 * prompt nor changes authored fields; saved references are revalidated natively. */
export class MemoryAssistantContext extends FormaElement{
 static override properties={candidateJobId:{attribute:'candidate-job-id'}};
 candidateJobId='';
 #owner:Owner|null=null;#view:AssistantMemoryContextView|null=null;#timer:ReturnType<typeof setTimeout>|undefined;
 #clock:ReturnType<typeof createMemoryElapsed>|null=null;#duration=0;#busy=false;#notice='';#suspended=false;#shown=false;
 #t=(key:string)=>personalMemoryMessage(this.i18n.locale,'memory.live.'+key);
 #clear(){this.#owner?.controller.abort();this.#owner=null;this.#view=null;this.#clock?.retire();this.#clock=null;clearTimeout(this.#timer);this.#timer=undefined;this.#busy=false;this.#notice='';this.#shown=false;}
 #hide=()=>{this.#suspended=true;this.#clear();this.requestUpdate();};
 #show=()=>{if(this.ownerDocument.visibilityState==='visible'){this.#suspended=false;this.#refresh();}};
 #visibility=()=>{if(this.ownerDocument.visibilityState==='hidden')this.#hide();else this.#show();};
 #changed=()=>this.#refresh();
 override connectedCallback(){super.connectedCallback();this.ownerDocument.addEventListener('visibilitychange',this.#visibility);window.addEventListener('pagehide',this.#hide);window.addEventListener('blur',this.#hide);window.addEventListener('pageshow',this.#show);window.addEventListener('focus',this.#show);window.addEventListener('forma-memory-privacy-mutation',this.#refresh);window.addEventListener('forma-memory-assistant-context-changed',this.#changed);}
 override disconnectedCallback(){this.#clear();this.ownerDocument.removeEventListener('visibilitychange',this.#visibility);window.removeEventListener('pagehide',this.#hide);window.removeEventListener('blur',this.#hide);window.removeEventListener('pageshow',this.#show);window.removeEventListener('focus',this.#show);window.removeEventListener('forma-memory-privacy-mutation',this.#refresh);window.removeEventListener('forma-memory-assistant-context-changed',this.#changed);super.disconnectedCallback();}
 protected override updated(){this.#sync();}
 #scope(){
  const session=this.store.session.get(),p=this.store.projection.get(),context=session?.projectContext;
  if(!session||session.impersonation||!Array.isArray(session.projects)||!p.projectId||!p.documentId)return null;
  const matches=session.projects.filter(project=>project.projectId===p.projectId);
  if(context?(context.projectId!==p.projectId||matches.length!==1||matches[0]!.organizationId!==context.organizationId||matches[0]!.projectAccessId!==context.projectAccessId):matches.length!==0)return null;
  const custody=parseMemoryCustody(context?{kind:'organization',organizationId:context.organizationId,projectAccessId:context.projectAccessId,ownerUserId:context.ownerUserId}:{kind:'personal'});
  const document=p.documents.find(row=>row.id===p.documentId&&row.projectId===p.projectId);
  return custody&&document?{projectId:p.projectId,documentId:p.documentId,stamp:JSON.stringify([custody,document.createdSequence,document.sourceEvents])}:null;
 }
 #sync(){
  if(this.#owner?.current())return;this.#clear();if(!this.isConnected||this.#suspended||memoryPrivacyMutationActive()||this.ownerDocument.visibilityState!=='visible')return;
  const store=this.store,session=store.session.get(),auth=store.captureAuthorizationScope(),source=store.captureSourceOwnership(),selected=this.#scope();
  if(!session||!auth||!selected||!store.sourceOwnershipActive(source))return;
  const route=store.route.get(),locale=this.i18n.locale,stamp=JSON.stringify(selected),candidate=this.candidateJobId,controller=new AbortController();
  const owner:Owner={scope:selected,controller,current:()=>this.#owner===owner&&!memoryPrivacyMutationActive()&&!controller.signal.aborted&&this.isConnected&&!this.#suspended&&this.ownerDocument.visibilityState==='visible'
   &&this.store===store&&store.session.get()?.user.userId===session.user.userId&&!store.session.get()?.impersonation&&store.authorizationScopeActive(auth)&&store.sourceOwnershipActive(source)
   &&store.route.get()===route&&this.i18n.locale===locale&&JSON.stringify(this.#scope())===stamp&&this.candidateJobId===candidate};
  this.#owner=owner;if(!candidate)void this.#load(owner);
 }
 #client(owner:Owner){return createAssistantMemoryContextClient((input,init)=>this.store.guardedFetch(input,init,this.#t('assistantContextHeading'),{current:owner.current}));}
 #retain(owner:Owner,view:AssistantMemoryContextView){
  if(!owner.current())return;this.#view=view;this.#clock=createMemoryElapsed({wall:Date.now(),monotonic:performance.now()});this.#duration=Date.parse(view.validUntil)-Date.now();
  this.#shown=Boolean(view.context);clearTimeout(this.#timer);this.#timer=setTimeout(()=>{
   if(!owner.current())return;const focused=this.contains(this.ownerDocument.activeElement);this.#view=null;this.#clock?.retire();this.#notice='assistantContextExpired';this.requestUpdate();
   if(focused)void this.updateComplete.then(()=>{if(owner.current())this.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});});
  },Math.max(0,this.#duration));this.requestUpdate();
 }
 async #load(owner:Owner){
  try{const view=await this.#client(owner).read(owner.scope,owner.controller.signal);this.#retain(owner,view);}
  catch{if(!owner.current())return;try{const view=await this.#client(owner).read(owner.scope,owner.controller.signal,true);if(owner.current()){this.#notice='assistantContextUnavailable';this.#retain(owner,view);}}catch{if(owner.current()){this.#view=null;this.requestUpdate();}}}
 }
 #refresh=()=>{this.#clear();this.#sync();this.requestUpdate();};
 async #act(action:'accept'|'dismiss'){
  const owner=this.#owner;if(!owner?.current()||this.#busy)return;
  const jobId=this.candidateJobId||this.#view?.context?.jobId;if(action==='accept'&&!jobId)return;
  this.#busy=true;this.#notice='';
  if(action==='dismiss'){this.#view=null;this.#clock?.retire();clearTimeout(this.#timer);this.#timer=undefined;}
  this.requestUpdate();
  try{
   const client=this.#client(owner),control=await client.read(owner.scope,owner.controller.signal,true);if(!owner.current())return;
   if(action==='accept')await client.accept(owner.scope,control,jobId!,owner.controller.signal);else await client.dismiss(owner.scope,control,owner.controller.signal);
   if(!owner.current())return;
   window.dispatchEvent(new Event('forma-memory-assistant-context-changed'));
   if(this.candidateJobId){this.#notice='assistantContextSaved';this.requestUpdate();}
  }catch{if(owner.current()){this.#notice='assistantContextUncertain';this.#view=null;this.#clock?.retire();}}
  finally{if(owner.current()){this.#busy=false;this.requestUpdate();}}
 }
 override render(){
  if(!this.#owner?.current())return nothing;
  if(this.candidateJobId)return html`<div><p class="memory-brief-disclosure">${this.#t('assistantContextChoiceHelp')}</p><button type="button" class="button ghost compact" ?disabled=${this.#busy} @click=${()=>this.#act('accept')}>${this.#t('assistantContextAccept')}</button>${this.#notice?html`<p role="status">${this.#t(this.#notice)}</p>`:nothing}</div>`;
  const view=this.#view&&this.#clock&&this.#clock.elapsed({wall:Date.now(),monotonic:performance.now()})<this.#duration&&Date.parse(this.#view.validUntil)>Date.now()?this.#view:null;
  if(!this.#shown&&!this.#notice)return nothing;
  return html`<aside class="document-memory-brief" data-memory-assistant-context aria-label=${this.#t('assistantContextHeading')}><header><h2>${this.#t('assistantContextHeading')}</h2><button type="button" class="button ghost compact" ?disabled=${this.#busy} @click=${this.#refresh}>${this.#t('briefRefresh')}</button></header>
   <p class="memory-brief-disclosure">${this.#t('assistantContextDisclosure')}</p>
   ${this.#notice?html`<p role="status">${this.#t(this.#notice)}</p>`:nothing}
   ${view?.context?.state==='accepted'?html`<p>${view.context.source.documentId}${view.context.source.ownerId?` (${view.context.source.ownerId})`:""} · ${this.#t('recallBoundary.'+view.context.source.zoom)}</p><ul>${view.presentation?.items.map(item=>html`<li>${item.text}</li>`)}</ul>`:nothing}
   ${view?.context?view.context.state==='dismissed'?html`<p>${this.#t('assistantContextDismissed')}</p><button type="button" class="button ghost compact" ?disabled=${this.#busy} @click=${()=>this.#act('accept')}>${this.#t('assistantContextUndo')}</button>`:html`<button type="button" class="button ghost compact" ?disabled=${this.#busy} @click=${()=>this.#act('dismiss')}>${this.#t('assistantContextDismiss')}</button>`:nothing}
  </aside>`;
 }
}
if(!customElements.get('forma-memory-assistant-context'))customElements.define('forma-memory-assistant-context',MemoryAssistantContext);
