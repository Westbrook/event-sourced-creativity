import {html,nothing,type PropertyValues} from 'lit';
import {FormaElement} from './forma-element.ts';
import {memoryPrivacyMutationActive} from '../state/memory-privacy-mutation.ts';
import {createMemoryElapsed} from '../model/memory-lifetime.ts';
import {readMemoryImageReply,type MemoryImageQuote,type MemoryImageReply} from '../state/memory-image-preview-client.ts';
import {memoryImagePreviewMessages} from './design-system/locales/memory-image-preview-messages.ts';

/** Separate private-image purchase/review and exact authored-image acceptance.
 * Nothing is published without the additional scope-bound checkbox; private
 * pixels never enter browser persistence. Source retirement removes this view. */
export class MemoryImagePreviewControls extends FormaElement{
 static override properties={endpoint:{type:String},turnId:{type:String},executionId:{type:String},bindingHash:{type:String},validUntil:{type:String}};
 endpoint='';turnId='';executionId='';bindingHash='';validUntil='';
 #adoption:MemoryImageReply['adoption'];#adoptApproved=false;#quote:MemoryImageQuote|null=null;#previewId='';#approved=false;#busy=false;#notice='';#image='';#suspended=false;
 #abort:AbortController|null=null;#timer:ReturnType<typeof setTimeout>|undefined;#clock:ReturnType<typeof createMemoryElapsed>|null=null;#duration=0;#scopeCurrent:(()=>boolean)|null=null;
 #text(){return memoryImagePreviewMessages[this.i18n.locale.startsWith('ar')?'ar':this.i18n.locale.startsWith('fr')?'fr':this.i18n.locale.startsWith('ja')?'ja':'en'];}
 #clear(){this.#adoption=undefined;this.#adoptApproved=false;this.#scopeCurrent=null;this.#abort?.abort();this.#abort=null;clearTimeout(this.#timer);this.#clock?.retire();this.#clock=null;this.#quote=null;this.#approved=false;this.#busy=false;this.#notice='';if(this.#image)URL.revokeObjectURL(this.#image);this.#image='';}
 #hide=()=>{this.#suspended=true;this.#clear();this.requestUpdate();};#show=()=>{this.#suspended=false;this.requestUpdate();};#privacy=()=>{this.#clear();this.requestUpdate();};
 #visibility=()=>{if(this.ownerDocument.visibilityState==='visible')this.#show();else this.#hide();};
 override connectedCallback(){super.connectedCallback();window.addEventListener('blur',this.#hide);window.addEventListener('pagehide',this.#hide);window.addEventListener('focus',this.#show);window.addEventListener('forma-memory-privacy-mutation',this.#privacy);window.addEventListener('forma-memory-context-invalidated',this.#privacy);document.addEventListener('visibilitychange',this.#visibility);}
 override disconnectedCallback(){this.#clear();window.removeEventListener('blur',this.#hide);window.removeEventListener('pagehide',this.#hide);window.removeEventListener('focus',this.#show);window.removeEventListener('forma-memory-privacy-mutation',this.#privacy);window.removeEventListener('forma-memory-context-invalidated',this.#privacy);document.removeEventListener('visibilitychange',this.#visibility);super.disconnectedCallback();}
 protected override willUpdate(changed:PropertyValues){super.willUpdate(changed);if(['endpoint','turnId','executionId','bindingHash','validUntil'].some(k=>changed.has(k))){this.#clear();this.#previewId='';}}
 #live(){return !!this.#scopeCurrent?.()&&!this.#suspended&&this.isConnected&&document.visibilityState==='visible'&&!memoryPrivacyMutationActive()&&Date.parse(this.validUntil)>Date.now()&&!!this.#clock&&this.#clock.elapsed({wall:Date.now(),monotonic:performance.now()})<this.#duration;}
 #retain(validUntil:string){clearTimeout(this.#timer);this.#clock?.retire();this.#clock=createMemoryElapsed({wall:Date.now(),monotonic:performance.now()});this.#duration=Math.min(30000,Date.parse(validUntil)-Date.now(),Date.parse(this.validUntil)-Date.now());if(this.#duration<=0)throw Error('expired');this.#timer=setTimeout(()=>{this.#clear();this.requestUpdate();},this.#duration);}
 async #run(action:'quote'|'execute'|'retrieve'|'resume'|'adopt'){
  if(this.#busy||this.#suspended||memoryPrivacyMutationActive()||document.visibilityState!=='visible'||Date.parse(this.validUntil)<=Date.now())return;
  const quote=this.#quote,adoption=this.#adoption;if(action==='adopt'&&(!this.#live()||!this.#image||!adoption||!this.#adoptApproved))return;if(action==='execute'&&(!this.#live()||!quote?.canExecute||!this.#approved||Date.parse(quote.expiresAt)<=Date.now()))return;
  if(action!=='quote'&&!this.#previewId)return;
  const endpoint=this.endpoint,turnId=this.turnId,executionId=this.executionId,bindingHash=this.bindingHash,validUntil=this.validUntil,store=this.store,source=store.captureSourceOwnership(),auth=store.captureAuthorizationScope(),route=store.route.get(),locale=this.i18n.locale;
  if(!auth||!store.sourceOwnershipActive(source)||store.session.get()?.impersonation)return;
  this.#clear();const abort=new AbortController();this.#abort=abort;this.#retain(validUntil);this.#busy=true;this.requestUpdate();
  this.#scopeCurrent=()=>this.endpoint===endpoint&&this.turnId===turnId&&this.executionId===executionId&&this.bindingHash===bindingHash&&this.validUntil===validUntil&&this.store===store&&store.route.get()===route&&store.sourceOwnershipActive(source)&&store.authorizationScopeActive(auth)&&!store.session.get()?.impersonation&&this.i18n.locale===locale;
  const current=()=>this.#abort===abort&&!abort.signal.aborted&&this.#live()&&this.endpoint===endpoint&&this.turnId===turnId&&this.executionId===executionId&&this.bindingHash===bindingHash&&this.validUntil===validUntil&&this.store===store&&store.route.get()===route&&store.sourceOwnershipActive(source)&&store.authorizationScopeActive(auth)&&!store.session.get()?.impersonation&&this.i18n.locale===locale;
  try{
   const url=new URL(endpoint,location.href);if(url.origin!==location.origin||url.pathname!=='/api/assistant/specialist')throw Error('endpoint');
   const response=await store.guardedFetch(url,{method:'POST',cache:'no-store',signal:abort.signal,headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({action:'image-preview',turnId,executionId,approvedBindingHash:bindingHash,previewAction:action,...(action!=='quote'?{previewExecutionId:this.#previewId}:{}),...(action==='execute'?{approvedPreviewHash:quote!.bindingHash}:{}),...(action==='adopt'?{approvedAdoptionHash:adoption!.hash,publishToDocument:true}:{})})},this.#text().heading,{current});
   if(!current()){void response.body?.cancel();return;}
   const v=await readMemoryImageReply(response,abort.signal);if(!current())return;
   if(action!=='quote'&&v.executionId!==this.#previewId)throw Error('identity');this.#previewId=v.executionId;this.#quote=v.quote??null;this.#adoption=v.adoption;
   if(v.applied){this.#clear();this.requestUpdate();this.dispatchEvent(new CustomEvent("memory-image-adopted",{bubbles:true,composed:true}));await store.refreshEvents();if(store.sourceOwnershipScopeActive(source))store.toast(v.applied.projected?this.#text().adopted:this.#text().adoptedPending);return;}
   this.#retain(v.validUntil);
   if(v.image){const bytes=Uint8Array.from(atob(v.image.encoded),c=>c.charCodeAt(0)),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');if(!current()||digest!==v.image.sha256)throw Error('image');this.#image=URL.createObjectURL(new Blob([bytes],{type:'image/jpeg'}));}
   else if(!v.quote||v.quote.status!=='quoted')this.#notice='pending';
  }catch{if(current())this.#notice='failed';}finally{if(current()){this.#busy=false;this.requestUpdate();}}
 }
 override render(){
  const c=this.#text(),live=this.#live(),quote=live?this.#quote:null,disabled=this.#busy||this.#suspended||memoryPrivacyMutationActive()||Date.parse(this.validUntil)<=Date.now();
  return html`<section class="forma-memory-private-image" aria-label=${c.heading}><h3>${c.heading}</h3><p>${c.detail}</p>
   <button class="button secondary" type="button" ?disabled=${disabled} @click=${()=>this.#run('quote')}>${c.quote}</button>
   ${quote?html`<p>${c.cost}: <bdi>${quote.models.join(', ')} · ${(quote.maximumMicrousd/1000000).toFixed(6)} USD</bdi></p><details><summary>${c.input}</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${JSON.stringify(quote.privateInput,null,2)}</pre></details>
    ${quote.status==='quoted'?html`<label><input type="checkbox" .checked=${this.#approved} ?disabled=${disabled||!quote.canExecute} @change=${(e:Event)=>{this.#approved=(e.target as HTMLInputElement).checked;this.requestUpdate();}}>${c.approve}</label><button class="button primary" type="button" ?disabled=${disabled||!quote.canExecute||!this.#approved} @click=${()=>this.#run('execute')}>${c.generate}</button>`:nothing}`:nothing}
   ${this.#previewId?html`<div><button type="button" class="button secondary" ?disabled=${disabled} @click=${()=>this.#run('retrieve')}>${c.retrieve}</button><button type="button" class="button secondary" ?disabled=${disabled} @click=${()=>this.#run('resume')}>${c.resume}</button></div>`:nothing}
   ${live&&this.#image?html`<img src=${this.#image} alt=${c.alt} width="1024" height="1024" style="display:block;max-width:100%;height:auto" referrerpolicy="no-referrer">${this.#adoption?html`<p>${c.adoptionDetail}</p><p><bdi>${this.#adoption.projectId} / ${this.#adoption.documentId}</bdi></p><label><input type="checkbox" .checked=${this.#adoptApproved} ?disabled=${disabled} @change=${(e:Event)=>{this.#adoptApproved=(e.target as HTMLInputElement).checked;this.requestUpdate();}}>${this.#adoption.shared?c.adoptShared:c.adoptPersonal}</label><button class="button primary" type="button" ?disabled=${disabled||!this.#adoptApproved} @click=${()=>this.#run('adopt')}>${c.adopt}</button>`:nothing}`:nothing}
   <p>${c.privacy}</p><p role="status">${live&&this.#notice?c[this.#notice as 'pending'|'failed']:nothing}</p>
  </section>`;
 }
}
if(!customElements.get('forma-memory-image-preview-controls'))customElements.define('forma-memory-image-preview-controls',MemoryImagePreviewControls);
