import { html, nothing } from 'lit';
import { FormaElement } from './forma-element';
import { createMemoryElapsed } from '../model/memory-lifetime';
import { readProjectContainment,saveProjectContainment } from '../state/project-containment-client';
import type { ProjectContainmentView } from '../model/project-containment';
import { projectContainmentMessage, type ProjectContainmentMessage } from './design-system/locales/project-containment-messages';

/** Explicit, short-lived structure editing. Never writes grants or enrolls Memory. */
export class FormaProjectContainment extends FormaElement {
 static properties={projectId:{type:String,attribute:'project-id'}};
 projectId='';
 #open=false;#busy=false;#mutating=false;#view:ProjectContainmentView|null=null;#parent='';#notice:ProjectContainmentMessage|null=null;
 #controller:AbortController|null=null;#timer:ReturnType<typeof setTimeout>|null=null;#current:(()=>boolean)|null=null;
 #elapsed:ReturnType<typeof createMemoryElapsed>|null=null;
 #copy=(key:ProjectContainmentMessage)=>projectContainmentMessage(this.i18n.locale,key);
 #reset=()=>{this.#controller?.abort();this.#controller=null;if(this.#timer)clearTimeout(this.#timer);this.#timer=null;
   this.#view=null;this.#parent='';this.#busy=false;this.#mutating=false;this.#current=null;this.#elapsed?.retire();this.#elapsed=null;};
 #retire=()=>{const uncertain=this.#mutating;this.#reset();this.#notice=uncertain?'uncertain':'expired';this.requestUpdate();};
 #changed=()=>{if(this.ownerDocument.visibilityState==='hidden'||this.#current&&!this.#current())this.#retire();};
 #unsubscribe:(()=>void)|null=null;
 override connectedCallback(){super.connectedCallback();this.#unsubscribe=this.store.subscribe(this.#changed);
  for(const name of ['forma-route-changed','forma-authorization-changed','forma-event-source-retired'])window.addEventListener(name,this.#retire);
  this.ownerDocument.addEventListener('visibilitychange',this.#changed);}
 override disconnectedCallback(){this.#reset();this.#unsubscribe?.();this.#unsubscribe=null;
  for(const name of ['forma-route-changed','forma-authorization-changed','forma-event-source-retired'])window.removeEventListener(name,this.#retire);
  this.ownerDocument.removeEventListener('visibilitychange',this.#changed);super.disconnectedCallback();}
 #valid(){if(!this.#current)return false;if(!this.#current()||!this.#elapsed||this.#elapsed.elapsed({wall:Date.now(),monotonic:performance.now()})>=30_000){this.#retire();return false;}return true;}
 #owner(){const source=this.store.captureSourceOwnership(),scope=this.store.captureAuthorizationScope(),projectId=this.projectId,route=this.store.route.get();
  return()=>this.isConnected&&this.#open&&this.projectId===projectId&&this.store.route.get()===route&&this.ownerDocument.visibilityState!=='hidden'
   &&this.store.sourceOwnershipActive(source)&&this.store.authorizationScopeActive(scope)&&this.store.projection.get().projects.some(project=>project.id===projectId)&&!this.store.session.get()?.impersonation;}
 async #load(saved=false){
  this.#reset();this.#notice=null;this.#current=this.#owner();if(!this.#current())return;
  this.#elapsed=createMemoryElapsed({wall:Date.now(),monotonic:performance.now()});const controller=this.#controller=new AbortController();
  this.#busy=true;this.#timer=setTimeout(this.#retire,30_000);this.requestUpdate();
  try{const view=await readProjectContainment(this.projectId,controller.signal);if(this.#controller!==controller||!this.#valid())return;
   this.#view=view;this.#parent=view.parentId??'';this.#notice=saved?'saved':null;
  }catch{if(this.#controller===controller&&!controller.signal.aborted)this.#notice='failed';}
  finally{if(this.#controller===controller){this.#busy=false;this.#mutating=false;this.requestUpdate();}}
 }
 async #save(event:SubmitEvent){event.preventDefault();const view=this.#view,parent=this.#parent||null;
  if(this.#busy||!view||!this.#valid()||parent===view.parentId&&view.ancestryComplete)return;
  const controller=this.#controller!;this.#busy=true;this.#mutating=true;this.#notice=null;this.requestUpdate();
  try{await saveProjectContainment(view,parent,controller.signal);if(this.#controller===controller&&this.#valid())await this.#load(true);}
  catch{if(this.#controller===controller){this.#view=null;this.#notice='uncertain';}}
  finally{if(this.#controller===controller){this.#busy=false;this.#mutating=false;this.requestUpdate();}}
 }
 #label(id:string){return this.store.projection.get().projects.find(project=>project.id===id)?.name
  ??this.store.session.get()?.projects?.find(project=>project.projectId===id)?.projectName??this.#copy('unknown');}
 override render(){
  const source=this.store.captureSourceOwnership();if(!this.store.sourceOwnershipActive(source)||this.store.session.get()?.impersonation)return nothing;
  const view=this.#valid()?this.#view:null;
  return html`<div class="project-containment"><button type="button" class="button ghost compact" aria-expanded=${String(this.#open)} @click=${()=>{
   this.#open=!this.#open;if(this.#open)void this.#load();else this.#reset();this.requestUpdate();}}>${this.#copy(this.#open?'close':'open')}</button>
   ${this.#open?html`<section aria-label=${this.#copy('open')} aria-busy=${String(this.#busy)}><p>${this.#copy('description')}</p>
    ${this.#busy?html`<p role="status">${this.#copy('loading')}</p>`:nothing}
    ${this.#notice?html`<p role="status">${this.#copy(this.#notice)}</p>`:nothing}
    ${view?html`${view.ancestors.length?html`<ol aria-label=${this.#copy('path')}>${view.ancestors.map(id=>html`<li dir="auto">${this.#label(id)}</li>`)}</ol>`:html`<p>${this.#copy(view.ancestryComplete?'empty':'restricted')}</p>`}
      ${!view.ancestryComplete&&view.ancestors.length?html`<p>${this.#copy('restricted')}</p>`:nothing}
      ${view.canReparent?html`<form @submit=${this.#save}><label>${this.#copy('parent')}<select .value=${this.#parent} ?disabled=${this.#busy} @change=${(event:Event)=>{if(this.#valid()){this.#parent=(event.currentTarget as HTMLSelectElement).value;this.requestUpdate();}}}>
        <option value="">${this.#copy('root')}</option>${view.candidates.map(id=>html`<option value=${id} ?selected=${id===this.#parent}>${this.#label(id)}</option>`)}</select></label>
        <button type="submit" class="button secondary compact" ?disabled=${this.#busy||this.#parent===(view.parentId??'')&&view.ancestryComplete}>${this.#copy('save')}</button></form>`:html`<p>${this.#copy('readOnly')}</p>`}`:nothing}
    <button type="button" class="button ghost compact" ?disabled=${this.#busy} @click=${()=>void this.#load()}>${this.#copy('refresh')}</button></section>`:nothing}</div>`;
 }
}
if(!customElements.get('forma-project-containment'))customElements.define('forma-project-containment',FormaProjectContainment);
