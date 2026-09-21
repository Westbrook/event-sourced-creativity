import { memoryResourceMessages as copy } from './design-system/locales/memory-resource-messages.ts';
import { html,nothing } from 'lit';
import { FormaElement } from './forma-element.ts';
import { memoryResourceSelector,type MemoryResourceSelector } from '../model/memory-resource-scope.ts';
import { createMemoryResourceClient,type ResourceSettings,type ResourceHistory } from '../state/memory-resource-client.ts';
import { beginMemoryPrivacyMutation,memoryPrivacyMutationActive } from '../state/memory-privacy-mutation.ts';
import { createMemoryElapsed } from '../model/memory-lifetime.ts';
import './memory-resource-controls.css';

type Owner={scope:MemoryResourceSelector;controller:AbortController;current:()=>boolean};
/** Explicit native-resource controls. A mount, focus or refresh never enrolls,
 * learns, follows linked documents or invokes a model. No private local storage. */
export class MemoryResourceControls extends FormaElement{
 static override properties={kind:{type:String},projectId:{type:String},resourceId:{type:String}};
 kind='';projectId='';resourceId='';
 #open=false;#busy=false;#writing=false;#suspended=false;#notice='';#consent=false;#background=false;#days=7;
 #owner:Owner|null=null;#settings:ResourceSettings|null=null;#history:ResourceHistory|null=null;#timer:ReturnType<typeof setTimeout>|undefined;#clock:ReturnType<typeof createMemoryElapsed>|null=null;#duration=0;
 #text(){return copy[this.i18n.locale.startsWith('ar')?'ar':this.i18n.locale.startsWith('fr')?'fr':this.i18n.locale.startsWith('ja')?'ja':'en'];}
 #selection(){return memoryResourceSelector({kind:this.kind,projectId:this.projectId,resourceId:this.resourceId});}
 #drop(){this.#settings=null;this.#history=null;clearTimeout(this.#timer);this.#clock?.retire();this.#clock=null;}
 #clear(){this.#owner?.controller.abort();this.#owner=null;this.#drop();this.#busy=false;this.#consent=false;this.#notice='';}
 #hide=()=>{this.#suspended=true;this.#clear();this.requestUpdate();};
 #show=()=>{this.#suspended=false;this.requestUpdate();};
 #visibility=()=>{if(this.ownerDocument.visibilityState==='hidden')this.#hide();else this.#show();};
 #privacy=()=>{this.#drop();if(!this.#writing)this.#clear();this.requestUpdate();};
 override connectedCallback(){super.connectedCallback();window.addEventListener('blur',this.#hide);window.addEventListener('pagehide',this.#hide);window.addEventListener('focus',this.#show);window.addEventListener('pageshow',this.#show);window.addEventListener('forma-memory-privacy-mutation',this.#privacy);this.ownerDocument.addEventListener('visibilitychange',this.#visibility);}
 override disconnectedCallback(){this.#clear();window.removeEventListener('blur',this.#hide);window.removeEventListener('pagehide',this.#hide);window.removeEventListener('focus',this.#show);window.removeEventListener('pageshow',this.#show);window.removeEventListener('forma-memory-privacy-mutation',this.#privacy);this.ownerDocument.removeEventListener('visibilitychange',this.#visibility);super.disconnectedCallback();}
 protected override updated(){if(this.#owner&&!this.#owner.current()){this.#clear();this.requestUpdate();}}
 #begin(){
  this.#clear();const scope=this.#selection(),store=this.store,session=store.session.get(),authorization=store.captureAuthorizationScope(),source=store.captureSourceOwnership(),route=store.route.get(),locale=this.i18n.locale;
  if(!scope||!session||session.impersonation||!authorization||!store.sourceOwnershipActive(source)||this.#suspended||memoryPrivacyMutationActive())return null;
  const controller=new AbortController(),stamp=JSON.stringify(scope);const owner:Owner={scope,controller,current:()=>this.#owner===owner&&!controller.signal.aborted&&this.isConnected&&this.#open&&!this.#suspended&&this.ownerDocument.visibilityState==='visible'&&(!memoryPrivacyMutationActive()||this.#writing)
   &&this.store===store&&store.session.get()?.user.userId===session.user.userId&&!store.session.get()?.impersonation&&store.authorizationScopeActive(authorization)&&store.sourceOwnershipActive(source)&&store.route.get()===route&&this.i18n.locale===locale&&JSON.stringify(this.#selection())===stamp};
  this.#owner=owner;return owner;
 }
 #client(owner:Owner){return createMemoryResourceClient((url,init)=>this.store.guardedFetch(url,init,this.#text().heading,{current:owner.current}));}
 #retain(deadline:string){this.#clock=createMemoryElapsed({wall:Date.now(),monotonic:performance.now()});this.#duration=Date.parse(deadline)-Date.now();clearTimeout(this.#timer);this.#timer=setTimeout(()=>{this.#drop();this.#notice='expiry';this.requestUpdate();},Math.max(0,this.#duration));}
 async #act(action:'settings'|'enable'|'forget'|'capture'|'recall'){
  const prior=this.#settings,agreed=this.#consent,background=this.#background,days=this.#days;
  if(action==='enable'&&(!agreed||!prior)||action==='forget'&&!prior?.enrollment||this.#busy)return;
  const owner=this.#begin();if(!owner)return;const client=this.#client(owner);this.#busy=true;this.#writing=['enable','forget'].includes(action);const finish=this.#writing?beginMemoryPrivacyMutation():null;this.requestUpdate();
  try{
   if(action==='settings'){const v=await client.settings(owner.scope,owner.controller.signal);if(owner.current()){this.#settings=v;this.#background=v.enrollment?.background??false;this.#days=v.enrollment?.retentionDays??7;this.#retain(v.validUntil);}}
   if(action==='enable'){await client.enable(owner.scope,owner.controller.signal,{revision:prior!.enrollment?.revision??0,background,retentionDays:days,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,expectedCustody:prior!.scope.organizationId?{kind:'organization',organizationId:prior!.scope.organizationId,projectAccessId:prior!.scope.projectAccessId!,ownerUserId:prior!.scope.ownerUserId}:{kind:'personal'},confirmation:'ENABLE_RESOURCE_MEMORY'});if(owner.current())this.#notice='saved';}
   if(action==='forget'){await client.forget(owner.scope,owner.controller.signal,prior!.enrollment!);if(owner.current())this.#notice='forgotten';}
   if(action==='capture'){const result=await client.capture(owner.scope,owner.controller.signal);if(owner.current())this.#notice=result.more?'more':'captured';}
   if(action==='recall'){const v=await client.recall(owner.scope,owner.controller.signal);if(owner.current()){this.#history=v;this.#retain(v.validUntil);}}
  }catch{if(owner.current())this.#notice='unavailable';}finally{finish?.();this.#writing=false;if(owner.current()){this.#busy=false;this.requestUpdate();}}
 }
 override render(){
  const c=this.#text(),scope=this.#selection();if(!scope||!this.store.session.get()||this.store.session.get()?.impersonation)return nothing;
  const live=this.#owner?.current()&&this.#clock&&this.#clock.elapsed({wall:Date.now(),monotonic:performance.now()})<this.#duration,settings=live?this.#settings:null,history=live?this.#history:null;
  return html`<section class="resource-memory"><button type="button" class="button secondary compact" aria-expanded=${this.#open} @click=${()=>{this.#open=!this.#open;this.#clear();this.requestUpdate();}}>${c.heading}</button>${this.#open?html`<div class="resource-memory-panel" role="region" aria-label=${c.heading}><header><h2>${scope.kind==='library'?c.library:c.canvas}</h2><button type="button" class="button ghost compact" @click=${()=>{this.#open=false;this.#clear();this.requestUpdate();}}>${c.close}</button></header><p>${c.intro}</p><p>${c.since}</p><div class="resource-memory-actions"><button type="button" class="button secondary" ?disabled=${this.#busy||this.#suspended||memoryPrivacyMutationActive()} @click=${()=>this.#act('settings')}>${c.refresh}</button>${settings?.enrollment?html`<button type="button" class="button secondary" ?disabled=${this.#busy} @click=${()=>this.#act('forget')}>${c.forget}</button><button type="button" class="button secondary" ?disabled=${this.#busy||!settings.enrollment.learn} @click=${()=>this.#act('capture')}>${c.review}</button><button type="button" class="button secondary" ?disabled=${this.#busy||!settings.enrollment.recall} @click=${()=>this.#act('recall')}>${c.read}</button>`:nothing}</div>${settings?html`<p>${settings.enrollment?c.active:c.inactive}</p><form @submit=${(e:SubmitEvent)=>{e.preventDefault();void this.#act('enable');}}><label>${c.days}<input type="number" min="1" max="30" step="1" .value=${String(this.#days)} @input=${(e:Event)=>{this.#days=Number((e.target as HTMLInputElement).value);this.requestUpdate();}}></label><label><input type="checkbox" .checked=${this.#background} @change=${(e:Event)=>{this.#background=(e.target as HTMLInputElement).checked;}}>${c.background}</label><label><input type="checkbox" .checked=${this.#consent} @change=${(e:Event)=>{this.#consent=(e.target as HTMLInputElement).checked;this.requestUpdate();}}>${c.consent}</label><button type="submit" class="button primary" ?disabled=${this.#busy||!this.#consent||!Number.isInteger(this.#days)||this.#days<1||this.#days>30}>${settings.enrollment?c.renew:c.enable}</button></form>`:nothing}${history?html`<p>${c.bounded}</p><div class="resource-memory-windows">${history.windows.map(w=>html`<article><h3>${this.i18n.number(w.days)} ${c.dayWindow}</h3>${Object.keys(w.counts).length?html`<dl>${Object.entries(w.counts).map(([k,n])=>html`<div><dt>${c[k as 'edit']}</dt><dd>${this.i18n.number(n)}</dd></div>`)}</dl>`:html`<p>${c.none}</p>`}</article>`)}</div>`:nothing}<p role="status">${this.#notice?c[this.#notice as 'saved']:nothing}</p></div>`:nothing}</section>`;
 }
}
if(!customElements.get('forma-memory-resource-controls'))customElements.define('forma-memory-resource-controls',MemoryResourceControls);

/** Source-free resource consent inventory. Forgetting never requires renewed source access or enrollment. */
export class MemoryResourceInventory extends FormaElement{
 #rows:import('../state/memory-resource-client.ts').ResourceControl[]=[];#next:string|null=null;#busy=false;#writing=false;#notice='';#suspended=false;#controller:AbortController|null=null;#current:(()=>boolean)|null=null;#timer:ReturnType<typeof setTimeout>|undefined;
 #text(){return copy[this.i18n.locale.startsWith('ar')?'ar':this.i18n.locale.startsWith('fr')?'fr':this.i18n.locale.startsWith('ja')?'ja':'en'];}
 #clear(){this.#controller?.abort();this.#controller=null;this.#current=null;this.#rows=[];this.#next=null;this.#busy=false;clearTimeout(this.#timer);}
 #hide=()=>{this.#suspended=true;this.#clear();this.requestUpdate();};#show=()=>{this.#suspended=false;this.requestUpdate();};
 #visibility=()=>{if(this.ownerDocument.visibilityState==='hidden')this.#hide();else this.#show();};
 #privacy=()=>{this.#rows=[];this.#next=null;if(!this.#writing)this.#clear();this.requestUpdate();};
 override connectedCallback(){super.connectedCallback();window.addEventListener('blur',this.#hide);window.addEventListener('pagehide',this.#hide);window.addEventListener('focus',this.#show);window.addEventListener('pageshow',this.#show);window.addEventListener('forma-memory-privacy-mutation',this.#privacy);this.ownerDocument.addEventListener('visibilitychange',this.#visibility);}
 override disconnectedCallback(){this.#clear();window.removeEventListener('blur',this.#hide);window.removeEventListener('pagehide',this.#hide);window.removeEventListener('focus',this.#show);window.removeEventListener('pageshow',this.#show);window.removeEventListener('forma-memory-privacy-mutation',this.#privacy);this.ownerDocument.removeEventListener('visibilitychange',this.#visibility);super.disconnectedCallback();}
 protected override updated(){if(this.#current&&!this.#current()){this.#clear();this.requestUpdate();}}
 async #run(row?:import('../state/memory-resource-client.ts').ResourceControl,after=''){
  if(this.#busy||this.#suspended||memoryPrivacyMutationActive())return;this.#clear();this.#notice='';const store=this.store,auth=store.captureAuthorizationScope(),session=store.session.get(),route=store.route.get(),locale=this.i18n.locale;
  if(!auth||!session||session.impersonation)return;const controller=new AbortController();this.#controller=controller;
  const current=()=>this.#controller===controller&&!controller.signal.aborted&&this.isConnected&&!this.#suspended&&this.ownerDocument.visibilityState==='visible'&&this.store===store&&this.i18n.locale===locale&&store.route.get()===route&&store.authorizationScopeActive(auth)&&store.session.get()?.user.userId===session.user.userId&&(!memoryPrivacyMutationActive()||this.#writing);this.#current=current;
  const client=createMemoryResourceClient((url,init)=>store.guardedFetch(url,init,this.#text().heading,{current}));this.#busy=true;this.#writing=!!row;const finish=row?beginMemoryPrivacyMutation():null;this.requestUpdate();
  try{if(row){await client.forget({kind:row.kind,projectId:row.projectId,resourceId:row.resourceId},controller.signal,row);if(current())this.#notice='forgotten';}
   else{const view=await client.controls(controller.signal,after);if(current()){this.#rows=view.enrollments;this.#next=view.nextAfter;this.#timer=setTimeout(()=>{this.#clear();this.#notice='expiry';this.requestUpdate();},Math.max(0,Date.parse(view.validUntil)-Date.now()));}}
  }catch{if(current())this.#notice='unavailable';}finally{finish?.();this.#writing=false;if(current()){this.#busy=false;this.requestUpdate();}}
 }
 override render(){const c=this.#text();return html`<section class="resource-memory resource-memory-inventory"><h3>${c.manage}</h3><p>${c.controlsOnly}</p><div class="resource-memory-actions"><button type="button" class="button secondary" ?disabled=${this.#busy||this.#suspended||memoryPrivacyMutationActive()} @click=${()=>this.#run()}>${c.refresh}</button>${this.#next?html`<button type="button" class="button secondary" ?disabled=${this.#busy} @click=${()=>this.#run(undefined,this.#next!)}>${c.next}</button>`:nothing}</div>${this.#current?.()?this.#rows.map(row=>html`<article><p><strong>${row.kind==='library'?c.library:c.canvas}</strong> · <bdi>${row.resourceId}</bdi></p><p>${c.owner}: <bdi>${row.ownerUserId}</bdi></p><button type="button" class="button secondary" ?disabled=${this.#busy} @click=${()=>this.#run(row)}>${c.forget}</button></article>`):nothing}<p role="status">${this.#notice?c[this.#notice as 'forgotten']:nothing}</p></section>`;}
}
if(!customElements.get('forma-memory-resource-inventory'))customElements.define('forma-memory-resource-inventory',MemoryResourceInventory);
