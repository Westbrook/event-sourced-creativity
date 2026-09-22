import {html,nothing} from 'lit';
import {FormaElement} from './forma-element';
import {sharedIdeaOutputNotices,type SharedIdeaOutputNotice} from '../model/shared-idea-output-freshness.ts';
import {nextActionFacts} from '../state/next-action-context.ts';
import {creativeActionSourceRevision} from '../model/workspace-intelligence.ts';
import {openSelectedCreativePreparationDestination} from './creative-next-action-navigation.ts';
export class SharedIdeaOutputNotices extends FormaElement {
 private dismissed=new Set<string>();
 private async updateOutput(notice:SharedIdeaOutputNotice){
  const store=this.store,source=store.captureSourceOwnership(),route=store.route.get();
  const facts=nextActionFacts(store,notice.documentId,null,{lifecycle:true});
  if(!facts.canConfigure)return;
  const target={kind:'configure' as const,projectId:facts.projectId,documentId:notice.documentId,canvasId:null,authorityKey:facts.authorityKey,sourceGeneration:facts.sourceGeneration,sourceRevision:creativeActionSourceRevision(facts),medium:notice.kind};
  const current=()=>store.sourceOwnershipActive(source);
  let refusalReported=false;
  const opened=await openSelectedCreativePreparationDestination(store,this.ownerDocument,{...target,medium:notice.kind},{origin:this,originCurrent:()=>this.isConnected&&current()&&store.route.get()===route,navigationCurrent:current,onRefusal:()=>{refusalReported=true;}});
  if(!opened&&!refusalReported&&current())store.toast(this.i18n.system('Open the document to review its output settings.'));
 }
 override render(){
  const p=this.store.projection.get(),notices=sharedIdeaOutputNotices(p,this.store.events.get()).filter(n=>!this.dismissed.has(n.key));
  const session=this.store.session.get(),canGenerate=!!session&&(!session.projectContext||session.projectContext.permissions.includes('project.author')&&session.projectContext.permissions.includes('project.output.request'));
  return notices.length?html`<aside aria-label=${this.i18n.system('Out-of-date outputs')} style="padding:1rem; border-bottom:1px solid var(--border);" role="status">${notices.map(n=>html`<div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap;margin:.5rem 0"><span><b>${n.documentTitle} · ${this.i18n.system('Output out of date')}</b><br>${this.i18n.system('A shared idea changed elsewhere. Would you like to update this output?')}</span>${canGenerate?html`<button class="button secondary compact" @click=${()=>void this.updateOutput(n)}>${this.i18n.system('Review and update output')}</button>`:nothing}<button class="button ghost compact" @click=${()=>{this.dismissed.add(n.key);this.requestUpdate();}}>${this.i18n.system('Later')}</button></div>`)}</aside>`:nothing;
 }
}
if(!customElements.get('forma-shared-idea-output-notices'))customElements.define('forma-shared-idea-output-notices',SharedIdeaOutputNotices);
