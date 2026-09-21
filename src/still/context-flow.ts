import type { WorkflowAction, WorkflowToolbar } from './workflow-toolbar.ts';
import { stillImage } from './media.ts';
import './form-elements.js';
import { LitElement, html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import { ApiError, StillClient } from './client.ts';
import { ContextWorkflow, type IdeaCandidate } from './context-workflow.ts';
import { compositionPlan, editableIdea } from './composition.ts';
import { isContextCompositionRelation } from '../model/combined-context.ts';
import { acquiredReferenceEvents } from './reference.ts';
import { documentSource } from './context.ts';
import type { EventInput } from '../model/events.ts';

const value = (v: unknown) => typeof v === 'string' ? v : '';
const sourceURL = (v: unknown) => { try { const u = new URL(String(v)); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; } };
export class StillContextFlow extends LitElement {
  static properties = { client: { attribute: false }, action: { type: String } };
  declare client: StillClient;
  action = '';
  private flow!: ContextWorkflow;
  private busy = false;
  private error = '';
  private index = 0;
  private composing = false;
  private phase = 'start';
  private query = '';
  private sourceDraft = '';
  private sourceBase = '';
  private member = '';
  private members: string[] = [];
  private application = 'isolate';
  private compositionBaseline = '';
  private plan: EventInput[] = [];
  private revision = '';
  private scopeKey = '';
  private targetId = '';
  private rights = false;
  private intake: IdeaCandidate | null = null;
  private uploadUncertain = false;
  private referenceEvents: EventInput[] | null = null;
  private beforeUnload = (e: BeforeUnloadEvent) => { if (this.preventsRouteChange) { e.preventDefault(); e.returnValue = ''; } };
  get preventsRouteChange(){return this.busy||this.composing||!!this.query||this.flow?.quote?.status==='uncertain'||this.flow?.status==='applying'||(this.action==='compose'&&this.phase==='compose'?JSON.stringify([this.members,this.application])!==this.compositionBaseline:this.phase!=='start');}
  createRenderRoot() { return this; }
  connectedCallback() { super.connectedCallback(); window.addEventListener('beforeunload',this.beforeUnload); }
  disconnectedCallback() { super.disconnectedCallback(); window.removeEventListener('beforeunload',this.beforeUnload); }
  protected firstUpdated() {
    this.scopeKey = this.client.scopeKey; this.targetId = this.client.position.blockId;
    this.revision = documentSource(this.client.projection,this.client.position.documentId).revision;
    if (this.action === 'compose') {
      const block = this.client.projection.blocks.find(b => b.id === this.targetId);
      this.application = value((block?.properties.context_group as Record<string,unknown>)?.application) || 'isolate';
      this.members = this.client.projection.blockRelations.filter(r=>!r.removed && r.fromBlockId===this.targetId && isContextCompositionRelation(r.kind)).sort((a,b)=>Number(a.properties.member_order??0)-Number(b.properties.member_order??0)).map(r=>r.toBlockId);
      this.compositionBaseline=JSON.stringify([this.members,this.application]);this.phase = 'compose'; this.requestUpdate();
    } else {
      this.flow = new ContextWorkflow(this.client,this.action==='split-context'?'decompose':'research');
      void this.run(async()=>{await this.flow.resume();this.phase=this.flow.preview?'review':'start'; if(this.flow.status==='applied') this.phase='completed';});
    }
  }
  private focusKey = '';
  protected updated() { this.dispatchEvent(new Event('workflow-toolbar-change',{bubbles:true})); const key=`${this.phase}:${this.index}`; if(key===this.focusKey)return;this.focusKey=key; const heading=this.querySelector('h1') as HTMLElement|null;if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});} }
  private done() { this.dispatchEvent(new CustomEvent('context-done',{bubbles:true})); }
  private back() { this.dispatchEvent(new CustomEvent('context-back',{bubbles:true})); }
  private command(label:string,run:()=>void,primary=false,disabled=false):WorkflowAction { return {id:`workflow:${this.phase}:${label.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`,label,run:()=>{if(!this.busy&&!this.composing&&!disabled)run();},variant:primary?'primary':'ghost',disabled:this.busy||this.composing||disabled}; }
  get toolbar():WorkflowToolbar {return {actions:this.commands(),status:this.busy?'Working…':!this.flow&&this.action!=='compose'?'Loading…':''};}
  private commands():WorkflowAction[] {
    const back=()=>this.command('Back',()=>this.back());
    if(this.action==='compose'){
      if(this.phase==='compose-review')return [this.command(this.client.hasUnconfirmedWrite?'Check save':'Save group',()=>void this.run(async()=>{if(!this.client.hasUnconfirmedWrite)await this.guardSource();await this.client.append(this.plan);this.done();}),true),this.command('Back',()=>{this.phase='compose';this.requestUpdate();},false,this.client.hasUnconfirmedWrite)];
      if(this.phase==='compose-behavior')return [this.command('Preview',()=>void this.run(async()=>{await this.guardSource();this.plan=compositionPlan(this.client.projection,this.targetId,this.members,this.application);this.phase='compose-review';}),true),this.command('Back',()=>{this.phase='compose';this.requestUpdate();})];
      return [this.command('Add',()=>{this.members=[...this.members,this.member];this.member='';this.requestUpdate();},false,!this.member||this.members.length>=40),this.command('Remove last',()=>{this.members=this.members.slice(0,-1);this.requestUpdate();},false,!this.members.length),this.command('Continue',()=>{this.phase='compose-behavior';this.requestUpdate();},true),back()];
    }
    const flow=this.flow;if(!flow)return [];
    if(this.phase==='source-refine')return [this.command(this.client.hasUnconfirmedWrite?'Check save':'Save',()=>void this.run(async()=>{if(!this.client.hasUnconfirmedWrite)await this.guardSource();await this.client.append([{type:'BlockPropertyEdited',payload:{block_id:this.targetId,property_path:'text',old_value:this.sourceBase,new_value:this.sourceDraft}}]);this.done();}),true),this.command('Keep original',()=>this.done(),false,this.client.hasUnconfirmedWrite)];
    if(this.phase==='completed')return [this.command('Edit shared direction',()=>{this.reviewSource();this.requestUpdate();}),this.command('Explore again',()=>void this.run(async()=>{await flow.dismiss();this.phase='start';}),true),this.command('Close',()=>this.back())];
    if(this.phase==='start')return [this.command('Review cost',()=>void this.run(()=>this.prepare()),true,this.query.length>140),back()];
    if(this.phase==='quote'){
      const q=flow.quote;
      return [q?this.command(q.status==='quoted'?'Approve analysis':'Check analysis',()=>void this.run(()=>this.analyze()),true,q.status==='quoted'&&(!q.providerAvailable||q.canExecute===false)):this.command('Review cost',()=>void this.run(()=>this.prepare()),true),back()];
    }
    if(this.phase==='intake'&&this.intake?.research)return [this.command(this.client.hasUnconfirmedWrite?'Check save':'Add reference',()=>void this.run(()=>this.importReference()),true,!this.rights),this.command('Back',()=>{this.phase='candidates';this.requestUpdate();},false,this.client.hasUnconfirmedWrite)];
    if(this.phase==='review'&&flow.preview)return [this.command(flow.status==='applying'?'Check save':'Apply',()=>void this.run(()=>this.apply()),true,flow.stale),...(flow.status!=='applying'?[this.command('Change selection',()=>void this.run(async()=>{await flow.dismiss();this.phase=flow.candidates.length?'candidates':'start';}))]:[]),this.command('Close',()=>this.back())];
    const candidate=flow.candidates[this.index],r=candidate?.research,proposal=candidate?.proposal;
    if(!candidate)return [this.command('Close',()=>this.back())];
    const reference=r?.type==='reference'&&r.area==='learned'&&!r.blockId;
    return [reference?this.command('Add reference',()=>{this.intake=candidate;this.rights=false;this.referenceEvents=null;this.phase='intake';this.requestUpdate();},true):this.command(candidate.included?'Deselect':'Select',()=>{candidate.included=!candidate.included;this.requestUpdate();},true,!!proposal&&(!candidate.text.trim()||candidate.text.length>1800)),this.command('Next',()=>{this.index=(this.index+1)%flow.candidates.length;this.requestUpdate();},false,flow.candidates.length<2),this.command(`Review (${flow.candidates.filter(c=>c.included).length})`,()=>void this.run(()=>this.review()),false,!flow.candidates.some(c=>c.included)),this.command('Close',()=>this.back())];
  }
  private async run(work:()=>Promise<void>) { if(this.busy||this.composing)return; this.busy=true;this.error='';this.requestUpdate();try {await work();}catch(e){this.error=e instanceof Error?e.message:'This step was interrupted.';}finally{this.busy=false;this.requestUpdate();} }
  private field(label:string,text:string,change:(v:string)=>void,rows=4) { return html`<en-textarea label=${label} .value=${live(text)} rows=${rows} .disabled=${this.busy||this.client.hasUnconfirmedWrite} @en-input=${(e:CustomEvent<{value:string;isComposing:boolean}>)=>{change(e.detail.value);this.composing=e.detail.isComposing;if(!this.composing)this.requestUpdate();}}></en-textarea>`; }
  private async prepare() { this.flow.publicQuery=this.query; await this.flow.prepareQuote(); this.phase='quote'; }
  private async analyze() { await this.flow.analyze(); this.phase='candidates';this.index=0; }
  private async review() { await this.flow.prepareChanges();this.phase='review'; }
  private async apply() {
    await this.flow.apply();
    if(this.flow.status==='applied') {
      if(this.flow.preview?.review?.proposals.some(p=>p.decomposition))this.reviewSource();
      else this.done();
    }
  }
  private reviewSource() {
    this.sourceBase=value(this.client.projection.blocks.find(b=>b.id===this.targetId)?.properties.text);this.sourceDraft=this.sourceBase;
    this.revision=documentSource(this.client.projection,this.client.position.documentId).revision;this.phase='source-refine';
  }
  private privateInput() {
    const input=this.flow.quote?.privateInput as Record<string,unknown>|undefined;
    if(!input)return nothing;
    const entries=[input.source,input.target,...['document_blocks','project_blocks','protected_constraints'].flatMap(key=>Array.isArray(input[key])?input[key] as unknown[]:[])].filter((v):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v));
    return html`<div class="analysis-input"><span class="eyebrow">Private analysis context</span>${entries.map(entry=>html`<p>${value(entry.text)}</p>`)}</div>`;
  }
  private async guardSource() {
    const check=await this.client.verifyScope(); await this.client.refresh();check();
    if(this.scopeKey!==this.client.scopeKey||this.targetId!==this.client.position.blockId||this.revision!==documentSource(this.client.projection,this.client.position.documentId).revision)throw new Error('Context changed. Reopen it to review the latest version.');
    return check;
  }
  private async importReference() {
    if(!this.intake?.research||!this.rights)throw new Error('Confirm image permissions.');
    const check=this.client.hasUnconfirmedWrite?await this.client.verifyScope():await this.guardSource(), candidate=this.intake.research;
    if(this.scopeKey!==this.client.scopeKey||this.targetId!==this.client.position.blockId)throw new Error('Open the original context to check this save.');
    const uploadKey=`still:reference-upload:${this.scopeKey}:${this.targetId}:${this.intake.selection.executionId}:${this.intake.selection.proposalId}`;
    if(!this.referenceEvents) {
      let pending=this.uploadUncertain;try{pending ||= sessionStorage.getItem(uploadKey)==='pending';}catch{/* Session storage may be unavailable; retain the in-memory upload state. */}
      if(pending)throw new Error('Upload unconfirmed. It was not repeated. Check Forma before importing again.');
      const url=new URL(candidate.imageUrl??'');
      if(url.protocol!=='https:'||url.hostname!=='upload.wikimedia.org'||url.username||url.password||!candidate.license)throw new Error('This reference cannot be imported.');
      const response=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw new Error('Image unavailable. Check its source.');
      if(Number(response.headers.get('content-length')??0)>12*1024*1024)throw new Error('Image exceeds 12 MB.');
      const blob=await response.blob();check();
      if(!['image/png','image/jpeg','image/webp'].includes(blob.type)||blob.size>12*1024*1024)throw new Error('Use PNG, JPEG, or WebP under 12 MB.');
      await this.guardSource();
      const form=new FormData();form.append('file',blob,`reference.${blob.type==='image/jpeg'?'jpg':blob.type.split('/')[1]}`);form.append('rightsConfirmed','true');form.append('nonSensitiveConfirmed','true');
      this.uploadUncertain=true;try{sessionStorage.setItem(uploadKey,'pending');}catch{/* Session storage may be unavailable; retain the in-memory upload state. */}
      const uploaded=await fetch('/api/media',{method:'POST',credentials:'same-origin',body:form});
      const media=await uploaded.json();if(!uploaded.ok){if([400,401,403,413,415,422,429].includes(uploaded.status)){this.uploadUncertain=false;try{sessionStorage.removeItem(uploadKey);}catch{/* Session storage may be unavailable; retain the in-memory upload state. */}}throw new ApiError(uploaded.status,media);}check();
      if(!value(media.url).startsWith('/api/media/')||!media.contentHash)throw new Error('Upload could not be confirmed.');
      const target=this.client.projection.blocks.find(b=>b.id===this.targetId);if(!target)throw new Error('Reference target unavailable.');
      this.referenceEvents=acquiredReferenceEvents(target,this.client.projection,this.intake,media);
      this.uploadUncertain=false;try{sessionStorage.removeItem(uploadKey);}catch{/* Session storage may be unavailable; retain the in-memory upload state. */}
    }
    if(!this.client.hasUnconfirmedWrite)await this.guardSource();
    await this.client.append(this.referenceEvents);this.done();
  }
  private renderCompose() {
    const blocks=this.client.projection.blocks, parent=blocks.find(b=>b.id===this.targetId);
    const choices=blocks.filter(b=>editableIdea(b)&&b.id!==this.targetId&&!this.members.includes(b.id));
    return html`<span class="eyebrow">${parent?.handle}</span><h1>Arrange ideas</h1><p>Removed members stay in the document.</p><ol class="assembly-list">${this.members.map(id=>html`<li><strong>${blocks.find(b=>b.id===id)?.handle}</strong><p>${value(blocks.find(b=>b.id===id)?.properties.text)}</p></li>`)}</ol>${this.phase==='compose-review'?html`<p class="cost-note">${this.application==='ordered'?'Ordered group.':this.application==='recur'?'Recurring group.':this.application==='co_locate'?'Same setting.':'Focused group.'}</p>`:html`<en-select class="select-label" label="Idea" .value=${this.member} @en-change=${(e: CustomEvent<{proposed:string;value:string}>)=>{this.member=e.detail.proposed;this.requestUpdate();}}><en-select-option value="">Choose an idea</en-select-option>${choices.map(b=>html`<en-select-option value=${b.id}>${b.handle}</en-select-option>`)}</en-select>`}`;
  }
  private renderBody() {
    const block=this.client?.projection.blocks.find(b=>b.id===this.targetId);
    if(this.action==='compose') {
      if(this.phase==='compose-behavior')return html`<h1>Group behavior</h1><en-select class="select-label" label="Relationship" .value=${this.application} @en-change=${(e: CustomEvent<{proposed:string;value:string}>)=>{this.application=e.detail.proposed;this.requestUpdate();}}><en-select-option value="isolate">Focused group</en-select-option><en-select-option value="co_locate">Same setting</en-select-option><en-select-option value="ordered">In order</en-select-option><en-select-option value="recur">Recurring</en-select-option></en-select>`;
      return this.renderCompose();
    }
    const flow=this.flow;if(!flow)return html`<p>Loading…</p>`;
    if(this.phase==='source-refine')return html`<h1>Shared direction</h1><p>Ideas saved. Remove repeated details; keep shared constraints.</p>${this.field('Text',this.sourceDraft,v=>this.sourceDraft=v)}<div class="change-review">${flow.preview?.changes.filter(c=>c.kind==='create').map(c=>html`<p><strong>${c.label}</strong> · ${c.text}</p>`)}</div>`;
    if(this.phase==='completed')return html`<h1>Saved</h1>`;
    if(this.phase==='start')return html`<span class="eyebrow">${block?.handle}</span><h1>${flow.kind==='decompose'?'Split idea':this.action==='find-references'?'Find references':'Research'}</h1><p class="context-preview">${value(block?.properties.text)}</p><p>${flow.kind==='decompose'?'Review smaller ideas. Keep what helps.':'Add a public topic to search the web and find images.'}</p>${flow.kind==='research'?this.field('Public topic · optional · 140 characters max',this.query,v=>this.query=v,2):nothing}`;
    if(this.phase==='quote') {
      const q=flow.quote;
      if(!q)return html`<h1>Review needed</h1>`;
      return html`<span class="eyebrow">${q.provider} · ${q.models.join(', ')}</span><h1>${q.status==='quoted'?'Review analysis':'Analysis status'}</h1><p>Maximum cost: $${(q.maximumMicrousd/1e6).toFixed(4)} · ${q.providerCalls} ${q.providerCalls===1?'provider call':'provider calls'} · ${q.searchCalls} ${q.searchCalls===1?'search':'searches'}</p><p>${q.publicQuery?`Public search: ${q.publicQuery}`:'Private analysis. No web search.'}</p>${this.privateInput()}${!q.providerAvailable?html`<p>Analysis unavailable for this account.</p>`:nothing}`;
    }
    if(this.phase==='intake'&&this.intake?.research) {
      const r=this.intake.research;
      return html`<h1>${r.label}</h1>${r.imageUrl?stillImage(r.imageUrl,r.label,undefined,{className:'reference-study',loading:'eager'}):nothing}<p>${r.attribution} · ${r.license}</p><p>Private copy with source and credit. Image guidance stays off.</p><en-checkbox class="check" label="I can use this image. It contains no sensitive personal data." .checked=${this.rights} .disabled=${this.busy||!!this.referenceEvents} @en-change=${(e: CustomEvent<{proposed:boolean}>)=>{this.rights=e.detail.proposed;this.requestUpdate();}}></en-checkbox>`;
    }
    if(this.phase==='review'&&flow.preview) return html`<span class="eyebrow">${flow.preview.blockCount} ${flow.preview.blockCount===1?'block':'blocks'} · ${flow.preview.relationCount} ${flow.preview.relationCount===1?'relationship':'relationships'}</span><h1>Review changes</h1>${flow.preview.changes.map(change=>html`<div class="change-review"><span class="eyebrow">${change.kind} · ${change.label}</span><p>${change.kind==='group'?({isolate:'Focused group',co_locate:'Same setting',ordered:'In this order',recur:'Recurring'}[change.text]??change.text):change.text}</p></div>`)}<p>Original wording is preserved.</p>${flow.stale?html`<p>Review outdated. Reopen the document.</p>`:nothing}`;
    const candidate=flow.candidates[this.index],r=candidate?.research,proposal=candidate?.proposal;
    if(!candidate)return html`<h1>No suggestions</h1><p>Try adding more detail.</p>`;
    const reference=r?.type==='reference'&&r.area==='learned'&&!r.blockId,source=sourceURL(r?.sourceUrl);
    return html`<span class="eyebrow">${this.index+1} / ${flow.candidates.length} · ${candidate.included?'Selected':reference?'Reference':'Suggestion'}</span><h1>${proposal?.label??r?.label}</h1>${reference&&r?.imageUrl?stillImage(r.imageUrl,r.label,undefined,{className:'reference-study',loading:'eager'}):nothing}${proposal?this.field('Idea',candidate.text,v=>candidate.text=v):html`<p class="context-preview">${candidate.text}</p>`}${proposal?.sourceExcerpt?html`<blockquote>${proposal.sourceExcerpt}</blockquote>`:nothing}${r?.reason?html`<p>${r.reason}</p>`:nothing}${r?.license?html`<p class="caption">${r.attribution} · ${r.license}</p>`:nothing}${source?html`<a class="source-link" href=${source} target="_blank" rel="noopener noreferrer">Source <en-icon name="link" aria-hidden="true"></en-icon></a>`:nothing}`;
  }
  render() { return html`<section class="form-page context-flow" aria-busy=${this.busy}>${this.renderBody()}${this.error?html`<p class="context-error" role="alert">${this.error}</p>`:nothing}</section>`; }
}
if(!customElements.get('still-context-flow'))customElements.define('still-context-flow',StillContextFlow);
