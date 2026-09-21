import { memoryFieldTextHash,type MemoryFieldRequest } from '../model/memory-field-request.ts';
import { html,nothing } from 'lit';
import { FormaElement } from './forma-element.ts';
import type { CreativeBlock } from '../model/events.ts';
import { memoryEditApprovalHash } from '../model/memory-edit-review.ts';
import { parseMemoryFieldCompletion,type MemoryFieldCompletion as Completion } from '../model/memory-field-completion.ts';
import { createMemoryElapsed } from '../model/memory-lifetime.ts';
import { memoryPrivacyMutationActive } from '../state/memory-privacy-mutation.ts';
import { readMemoryFieldResponse } from '../state/memory-field-response.ts';
import type { CapturedSourceOwnership } from '../state/store.ts';

export type MemoryFieldGenerationIntent={projectId:string;documentId:string;target:MemoryFieldRequest;current:()=>boolean;accepted:boolean};
type ReadOwner={controller:AbortController;source:CapturedSourceOwnership;identity:string};
/** Inline saved-result reuse and explicit fresh-generation review. Neither
 * action captures keystrokes, changes drafts, buys generation or auto-accepts. */
export class MemoryFieldCompletion extends FormaElement{
 static override properties={block:{attribute:false},draft:{attribute:false},composing:{type:Boolean},disabled:{type:Boolean},fieldCurrent:{attribute:false}};
 block!:CreativeBlock;draft='';composing=false;disabled=false;fieldCurrent:()=>boolean=()=>false;
 #generation=0;#owner:ReadOwner|null=null;#view:Completion|null=null;#busy=false;#notice='';#hidden=false;
 #clock:ReturnType<typeof createMemoryElapsed>|null=null;#duration=0;#timer:ReturnType<typeof setTimeout>|undefined;
 #t=(key:string)=>this.i18n.t('assistant.specialist.'+key);
 #target(){return{projectId:this.block.projectId,documentId:this.block.documentId,blockId:this.block.id,revision:this.block.sourceEvents.length,text:String(this.block.properties.text??''),locale:this.i18n.locale};}
 #identity(){return JSON.stringify([this.store.route.get(),this.#target()]);}
 #eligible(){const session=this.store.session.get(),projection=this.store.projection.get(),current=projection.blocks.find(block=>block.id===this.block?.id);
  return Boolean(this.isConnected&&!this.#hidden&&!this.disabled&&!this.composing&&!memoryPrivacyMutationActive()&&this.fieldCurrent()
   &&this.ownerDocument.visibilityState==='visible'&&session?.assistant?.phase==='actions'&&this.block?.scope==='document'&&!this.block.locked&&!this.block.removed
   &&this.block.documentId===projection.documentId&&this.block.projectId===projection.projectId&&current&&!current.locked&&!current.removed
   &&current.sourceEvents.length===this.block.sourceEvents.length&&current.properties.text===this.block.properties.text
   &&this.draft===String(this.block.properties.text??'')&&Array.from(this.draft).length<=1200);
 }
 #current(owner:ReadOwner){return this.#owner===owner&&!owner.controller.signal.aborted&&this.#eligible()&&this.#identity()===owner.identity&&this.store.sourceOwnershipActive(owner.source);}
 #clear(){this.#generation++;this.#owner?.controller.abort();this.#owner=null;this.#view=null;this.#clock?.retire();this.#clock=null;clearTimeout(this.#timer);this.#timer=undefined;this.#busy=false;}
 retire(){this.#clear();this.#notice='';this.requestUpdate();}
 #hide=()=>{this.#hidden=true;this.retire();};
 #focus=()=>{this.#hidden=false;this.requestUpdate();};
 #privacy=()=>{if(memoryPrivacyMutationActive())this.retire();};
 #visibility=()=>{if(this.ownerDocument.visibilityState!=='visible')this.#hide();else this.#focus();};
 override connectedCallback(){super.connectedCallback();window.addEventListener('blur',this.#hide);window.addEventListener('pagehide',this.#hide);window.addEventListener('focus',this.#focus);window.addEventListener('forma-memory-privacy-mutation',this.#privacy);this.ownerDocument.addEventListener('visibilitychange',this.#visibility);}
 override disconnectedCallback(){this.#clear();window.removeEventListener('blur',this.#hide);window.removeEventListener('pagehide',this.#hide);window.removeEventListener('focus',this.#focus);window.removeEventListener('forma-memory-privacy-mutation',this.#privacy);this.ownerDocument.removeEventListener('visibilitychange',this.#visibility);super.disconnectedCallback();}
 protected override willUpdate(){if(this.#owner&&!this.#current(this.#owner))this.#clear();this.#expire();}
 #expire(){if(this.#clock&&this.#duration-this.#clock.elapsed({wall:Date.now(),monotonic:performance.now()})<=0){this.#clear();this.#notice=this.#t('fieldExpired');}}
 #url(path:string){const query=new URLSearchParams({route:this.store.route.get(),projectId:this.block.projectId});return path+'?'+query;}
 async #generate(){
  if(this.#busy||!this.#eligible())return;this.#clear();this.#notice='';
  const generation=this.#generation,identity=this.#identity(),target=this.#target();
  const current=()=>generation===this.#generation&&this.#eligible()&&identity===this.#identity();
  try{
   const textHash=await memoryFieldTextHash(target.text);if(!current())return;
   const detail:MemoryFieldGenerationIntent={projectId:target.projectId,documentId:target.documentId,
    target:{blockId:target.blockId,field:'text',revision:target.revision,textHash},current,accepted:false};
   window.dispatchEvent(new CustomEvent('forma-memory-field-generate',{detail}));
   this.#notice=this.#t(detail.accepted?'fieldGenerationReview':'fieldUnavailable');
  }catch{if(current())this.#notice=this.#t('fieldUnavailable');}
  this.requestUpdate();
 }
 async #read(){
  if(this.#busy||!this.#eligible())return;this.#clear();this.#notice='';
  const source=this.store.captureSourceOwnership();if(!source)return;
  const owner:ReadOwner={controller:new AbortController(),source,identity:this.#identity()};this.#owner=owner;this.#busy=true;this.#timer=setTimeout(()=>{if(this.#owner===owner){this.#clear();this.#notice=this.#t('fieldUnavailable');this.requestUpdate();}},15000);this.requestUpdate();
  try{
   const url=this.#url('/api/assistant/field-suggestion')+'&'+new URLSearchParams({blockId:this.block.id,locale:this.i18n.locale});
   const response=await this.store.guardedFetch(url,{cache:'no-store',signal:owner.controller.signal,headers:{accept:'application/json'}},this.#t('fieldCheck'));
   if(!this.#current(owner))return;const body=await readMemoryFieldResponse(response,owner.controller.signal) as Record<string,unknown>;if(!this.#current(owner))return;
   if(!response.ok||body.version!=='memory-field-completion-v1')throw Error('field-unavailable');
   const view=parseMemoryFieldCompletion(body.suggestion,this.#target());
   if(!view){this.#clear();this.#notice=this.#t('fieldNone');return;}
   this.#view=view;const now=Date.now();this.#clock=createMemoryElapsed({wall:now,monotonic:performance.now()});this.#duration=Date.parse(view.validUntil)-now;
   clearTimeout(this.#timer);this.#timer=setTimeout(()=>{this.#expire();this.requestUpdate();},Math.max(1,this.#duration));
  }catch{if(this.#current(owner)){this.#clear();this.#notice=this.#t('fieldUnavailable');}}
  finally{if(this.#owner===owner)this.#busy=false;this.requestUpdate();}
 }
 async #apply(){
  this.#expire();const owner=this.#owner,view=this.#view;if(this.#busy||!owner||!view||!this.#current(owner)||!parseMemoryFieldCompletion(view,this.#target()))return;
  this.#busy=true;clearTimeout(this.#timer);this.#timer=setTimeout(()=>{if(this.#owner===owner){this.#clear();this.#notice=this.#t('editNotConfirmed');this.requestUpdate();}},Math.max(1,Math.min(15000,this.#duration-(this.#clock?.elapsed({wall:Date.now(),monotonic:performance.now()})??Infinity))));this.requestUpdate();
  try{
   const edit=view.review.edits[0]!,hash=await memoryEditApprovalHash(view.review,edit.blockId);
   if(!hash||!this.#current(owner)||!parseMemoryFieldCompletion(view,this.#target()))return;
   const response=await this.store.guardedFetch(this.#url('/api/assistant/specialist'),{method:'POST',cache:'no-store',signal:owner.controller.signal,
    headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({action:'apply-edit',turnId:view.review.turnId,executionId:view.review.executionId,
     approvedBindingHash:view.bindingHash,blockId:edit.blockId,approvedEditHash:hash,publishToDocument:true})},this.#t('editApply'));
   if(!this.#current(owner))return;const body=await readMemoryFieldResponse(response,owner.controller.signal) as Record<string,unknown>;if(!this.#current(owner))return;
   if(!response.ok||body.status!=='applied'||body.executionId!==view.review.executionId||body.blockId!==edit.blockId||typeof body.eventId!=='string'||!body.eventId)throw Error('field-unconfirmed');
   const route=this.store.route.get(),locale=this.i18n.locale,draft=this.draft;
   this.#clear();const generation=this.#generation;await this.store.refreshEvents();
   // The authoring transaction may have succeeded even when the editor has
   // since moved. Never close a different editor or refocus after withdrawal.
   if(this.isConnected&&generation===this.#generation&&!this.#hidden&&!memoryPrivacyMutationActive()
    &&this.ownerDocument.visibilityState==='visible'&&this.store.sourceOwnershipScopeActive(owner.source)
    &&this.store.route.get()===route&&this.i18n.locale===locale&&this.draft===draft&&!this.composing
    &&this.block.id===edit.blockId&&this.block.documentId===view.review.documentId&&this.block.projectId===view.review.projectId){
    this.store.rememberMemoryAuthoredEdit({eventId:body.eventId,executionId:view.review.executionId,turnId:view.review.turnId,blockId:edit.blockId,projectId:view.review.projectId,documentId:view.review.documentId});
    this.dispatchEvent(new CustomEvent('forma-memory-field-applied',{detail:{blockId:edit.blockId,eventId:body.eventId},bubbles:true,composed:true}));
    this.store.toast(this.#t('editApplied'));
   }
  }catch{if(this.#current(owner)){this.#clear();this.#notice=this.#t('editNotConfirmed');}}
  finally{if(this.#owner===owner)this.#busy=false;this.requestUpdate();}
 }
 override render(){
  if(this.store.session.get()?.assistant?.phase!=='actions')return nothing;
  const view=this.#view;
  return html`<aside class="memory-field-completion" aria-label=${this.#t('fieldTitle')} @keydown=${(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.isComposing&&(view||this.#busy)){event.preventDefault();event.stopPropagation();this.retire();}}}>
   <button type="button" class="button ghost compact" ?disabled=${this.#busy||!this.#eligible()} @click=${()=>void this.#read()}>${this.#t('fieldCheck')}</button>
   <button type="button" class="button ghost compact" ?disabled=${this.#busy||!this.#eligible()} @click=${()=>void this.#generate()}>${this.#t('fieldGenerate')}</button>
   ${this.#notice?html`<p role="status">${this.#notice}</p>`:nothing}
   ${view?html`<p>${this.#t('fieldDetail')}</p><p dir="auto" style="white-space:pre-wrap;overflow-wrap:anywhere">${view.review.edits[0]!.suggestedText}</p>
    <p>${this.#t('editPublishDetail')}</p><button type="button" class="button secondary compact" ?disabled=${this.#busy||!this.#eligible()} @click=${()=>void this.#apply()}>${this.#t('editApply')}</button>
    <button type="button" class="button ghost compact" @click=${()=>this.retire()}>${this.#t('fieldDismiss')}</button>`:nothing}
  </aside>`;
 }
}
if(!customElements.get('forma-memory-field-completion'))customElements.define('forma-memory-field-completion',MemoryFieldCompletion);
