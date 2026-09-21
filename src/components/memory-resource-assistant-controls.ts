import { html,nothing } from 'lit';
import { FormaElement } from './forma-element.ts';
import { memoryResourceSelector,type MemoryResourceSelector } from '../model/memory-resource-scope.ts';
import { createMemoryElapsed } from '../model/memory-lifetime.ts';
import { memoryPrivacyMutationActive } from '../state/memory-privacy-mutation.ts';
import { createResourceAssistantClient,type ResourceAssistantQuote,type ResourceAssistantResult,type ResourceAssistantRun } from '../state/memory-resource-assistant-client.ts';
import { resourceAssistantMessages } from './design-system/locales/memory-resource-assistant-messages.ts';

/** Read-only native resource consumer. Selection, quotation and purchase are
 * separate actions. Private drafts/answers do not survive ownership or visibility. */
export class MemoryResourceAssistantControls extends FormaElement{
 static override properties={kind:{type:String},projectId:{type:String},resourceId:{type:String},contextId:{type:String}};
 kind='';projectId='';resourceId='';contextId='';
 #question='';#approval=false;#busy=false;#suspended=false;#notice='';
 #quote:ResourceAssistantQuote|null=null;#result:ResourceAssistantResult|null=null;#runs:ResourceAssistantRun[]=[];#more=false;
 #controller:AbortController|null=null;#current:(()=>boolean)|null=null;#timer:ReturnType<typeof setTimeout>|undefined;
 #clock:ReturnType<typeof createMemoryElapsed>|null=null;#duration=0;
 #locale(){return this.i18n.locale.startsWith('ar')?'ar':this.i18n.locale.startsWith('fr')?'fr':this.i18n.locale.startsWith('ja')?'ja':'en';}
 #text(){return resourceAssistantMessages[this.#locale()];}
 #clear(){this.#controller?.abort();this.#controller=null;this.#current=null;clearTimeout(this.#timer);this.#clock?.retire();this.#clock=null;this.#quote=null;this.#result=null;this.#runs=[];this.#more=false;this.#question='';this.#approval=false;this.#busy=false;this.#notice='';}
 #hide=()=>{this.#suspended=true;this.#clear();this.requestUpdate();};#show=()=>{this.#suspended=false;this.requestUpdate();};
 #privacy=()=>{this.#clear();this.requestUpdate();};#visibility=()=>{if(this.ownerDocument.visibilityState==='hidden')this.#hide();else this.#show();};
 override connectedCallback(){super.connectedCallback();window.addEventListener('blur',this.#hide);window.addEventListener('pagehide',this.#hide);window.addEventListener('focus',this.#show);window.addEventListener('pageshow',this.#show);window.addEventListener('forma-memory-privacy-mutation',this.#privacy);this.ownerDocument.addEventListener('visibilitychange',this.#visibility);}
 override disconnectedCallback(){this.#clear();window.removeEventListener('blur',this.#hide);window.removeEventListener('pagehide',this.#hide);window.removeEventListener('focus',this.#show);window.removeEventListener('pageshow',this.#show);window.removeEventListener('forma-memory-privacy-mutation',this.#privacy);this.ownerDocument.removeEventListener('visibilitychange',this.#visibility);super.disconnectedCallback();}
 protected override updated(){if(this.#current&&!this.#current()){this.#clear();this.requestUpdate();}}
 #retain(until:string){clearTimeout(this.#timer);this.#clock?.retire();this.#clock=createMemoryElapsed({wall:Date.now(),monotonic:performance.now()});this.#duration=Math.max(0,Date.parse(until)-Date.now());this.#timer=setTimeout(()=>{this.#clear();this.#notice='expired';this.requestUpdate();},this.#duration);}
 #begin():{scope:MemoryResourceSelector;signal:AbortSignal;current:()=>boolean}|null{
  this.#clear();const scope=memoryResourceSelector({kind:this.kind,projectId:this.projectId,resourceId:this.resourceId}),store=this.store,session=store.session.get(),auth=store.captureAuthorizationScope(),source=store.captureSourceOwnership(),route=store.route.get(),locale=this.i18n.locale,contextId=this.contextId;
  if(!scope||!session||session.impersonation||!auth||!store.sourceOwnershipActive(source)||this.#suspended||this.ownerDocument.visibilityState!=='visible'||memoryPrivacyMutationActive())return null;
  const controller=new AbortController();this.#controller=controller;const current=()=>this.#controller===controller&&!controller.signal.aborted&&this.isConnected&&!this.#suspended&&this.ownerDocument.visibilityState==='visible'&&!memoryPrivacyMutationActive()&&this.store===store&&store.route.get()===route&&store.session.get()?.user.userId===session.user.userId&&!store.session.get()?.impersonation&&store.authorizationScopeActive(auth)&&store.sourceOwnershipActive(source)&&this.i18n.locale===locale&&this.contextId===contextId&&this.kind===scope.kind&&this.projectId===scope.projectId&&this.resourceId===scope.resourceId;
  this.#current=current;this.#retain(new Date(Date.now()+30000).toISOString());return {scope,signal:controller.signal,current};
 }
 #draft(event:Event){const text=(event.target as HTMLTextAreaElement).value;if(this.#busy)return;if(!this.#current?.()&&!this.#begin())return;this.#quote=null;this.#approval=false;this.#question=text;this.requestUpdate();}
 #completeDraft(value:string){
  if(this.#busy||this.#question.trim()||!this.#current?.()||!this.#clock||this.#clock.elapsed({wall:Date.now(),monotonic:performance.now()})>=this.#duration||!this.#result?.result?.nextQuestions?.includes(value))return;
  // Preserve the original private lease. Selection is local, never a send,
  // provider approval, event or claim that this was independent user intent.
  this.#question=value;this.#quote=null;this.#approval=false;this.requestUpdate();
  void this.updateComplete.then(()=>{if(this.#current?.())this.querySelector('textarea')?.focus();});
 }
 async #run(action:'quote'|'execute'|'controls'|'retrieve'|'resume'|'reconcile',id=''){
  if(this.#busy)return;const question=this.#question,quote=this.#quote,approval=this.#approval;
  if((action==='quote'||action==='execute')&&(!this.#current?.()||!this.#clock||this.#clock.elapsed({wall:Date.now(),monotonic:performance.now()})>=this.#duration))return;
  if(action==='quote'&&(!this.contextId||!question.trim()||Array.from(question).length>2000)||action==='execute'&&(!quote||!approval||!quote.quote.canExecute||!this.#current?.()||!this.#clock||this.#clock.elapsed({wall:Date.now(),monotonic:performance.now()})>=this.#duration||Date.parse(quote.quote.expiresAt)<=Date.now()))return;
  const owner=this.#begin();if(!owner)return;this.#busy=true;this.requestUpdate();
  const client=createResourceAssistantClient((url,init)=>this.store.guardedFetch(url,init,this.#text().heading,{current:owner.current}));
  try{
   if(action==='quote'){const v=await client.quote(owner.scope,owner.signal,this.contextId,question,this.#locale());if(owner.current()){this.#quote=v;this.#retain(new Date(Math.min(Date.parse(v.validUntil),Date.parse(v.quote.expiresAt))).toISOString());}}
   else if(action==='controls'){const v=await client.controls(owner.scope,owner.signal);if(owner.current()){this.#runs=v.runs;this.#more=v.more;this.#notice=v.runs.length?'':'none';}}
   else if(action==='reconcile'){await client.reconcile(owner.scope,owner.signal,id);if(owner.current())this.#notice='reconciled';}
   else{const v=await client.read(owner.scope,owner.signal,action,action==='execute'?quote!.executionId:id,action==='execute'?quote!.quote.bindingHash:undefined);if(owner.current()){this.#result=v;this.#retain(v.validUntil);if(!v.result)this.#notice='pending';}}
  }catch{if(owner.current())this.#notice='unconfirmed';}finally{if(owner.current()){this.#busy=false;this.requestUpdate();}}
 }
 override render(){
  const c=this.#text(),live=this.#current?.()&&this.#clock&&this.#clock.elapsed({wall:Date.now(),monotonic:performance.now()})<this.#duration,q=live?this.#quote:null,result=live?this.#result:null,disabled=this.#busy||this.#suspended||memoryPrivacyMutationActive();
  return html`<section class="resource-memory-assistant" aria-label=${c.heading}><h3>${c.heading}</h3><p>${c.intro}</p>${this.contextId?html`<form @submit=${(e:SubmitEvent)=>{e.preventDefault();void this.#run('quote');}}><label class="resource-memory-question">${c.question}<textarea maxlength="4000" rows="3" .value=${live?this.#question:''} ?disabled=${disabled} @input=${this.#draft}></textarea></label><button type="submit" class="button secondary" ?disabled=${disabled||!live||!this.#question.trim()||Array.from(this.#question).length>2000}>${c.quote}</button></form>`:html`<p>${c.selection}</p>`}
   ${q?html`<section><h4>${c.review}</h4><p>${c.cost}: <bdi>${(q.quote.maximumMicrousd/1000000).toFixed(6)} USD</bdi> · <bdi>${q.quote.models.join(', ')}</bdi></p><details><summary>${c.input}</summary><pre>${JSON.stringify(q.quote.privateInput,null,2)}</pre></details><label><input type="checkbox" .checked=${this.#approval} ?disabled=${disabled||!q.quote.canExecute} @change=${(e:Event)=>{this.#approval=(e.target as HTMLInputElement).checked;this.requestUpdate();}}>${c.approval}</label><button type="button" class="button primary" ?disabled=${disabled||!this.#approval||!q.quote.canExecute} @click=${()=>this.#run('execute')}>${c.execute}</button>${q.quote.canExecute?nothing:html`<p>${c.unavailable}</p>`}</section>`:nothing}
   ${result?.result?html`<article class="resource-memory-answer"><h4>${c.answer}</h4><p>${result.result.reply}</p><p>${c.tentative}</p>${result.result.nextQuestions?.length?html`<section data-memory-next-questions><h4>${c.nextQuestions}</h4><p>${c.nextQuestionsDetail}</p>${result.result.nextQuestions.map(question=>html`<button type="button" class="button secondary" ?disabled=${disabled||!!this.#question.trim()} @click=${()=>this.#completeDraft(question)}>${question}</button>`)}</section>`:nothing}</article>`:nothing}
   <details><summary>${c.recovery}</summary><p>${c.recoveryExplanation}</p><button type="button" class="button secondary" ?disabled=${disabled} @click=${()=>this.#run('controls')}>${c.check}</button>${live?this.#runs.map(run=>html`<article><p><bdi>${run.execution_id}</bdi></p><p>${c.owner}: <bdi>${run.owner_user_id}</bdi> · <bdi>${run.created_at}</bdi> · <bdi>${run.status}</bdi></p><div class="resource-memory-actions"><button type="button" class="button secondary" ?disabled=${disabled||run.state!=='active'} @click=${()=>this.#run('retrieve',run.execution_id)}>${c.view}</button><button type="button" class="button secondary" ?disabled=${disabled||run.state!=='active'} @click=${()=>this.#run('resume',run.execution_id)}>${c.resume}</button><button type="button" class="button secondary" ?disabled=${disabled} @click=${()=>this.#run('reconcile',run.execution_id)}>${c.reconcile}</button></div></article>`):nothing}${live&&this.#more?html`<p>${c.more}</p>`:nothing}</details><p role="status">${this.#notice?c[this.#notice as 'unconfirmed']:nothing}</p></section>`;
 }
}
if(!customElements.get('forma-memory-resource-assistant-controls'))customElements.define('forma-memory-resource-assistant-controls',MemoryResourceAssistantControls);
