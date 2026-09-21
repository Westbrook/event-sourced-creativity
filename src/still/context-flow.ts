import { ideaActionTargets } from './idea-actions.ts';
import type { WorkflowAction, WorkflowToolbar } from './workflow-toolbar.ts';
import { stillImage } from './media.ts';
import './form-elements.js';
import { LitElement, html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import { ApiError, StillClient } from './client.ts';
import { ContextWorkflow, type IdeaCandidate } from './context-workflow.ts';
import { compositionPlan, editableIdea } from './composition.ts';
import { isContextCompositionRelation } from '../model/combined-context.ts';
import { acquiredReferenceEvents, suppliedReferenceEvents } from './reference.ts';
import { documentSource } from './context.ts';
import type { EventInput } from '../model/events.ts';

const value = (v: unknown) => typeof v === 'string' ? v : '';
const sourceURL = (v: unknown) => { try { const u = new URL(String(v)); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; } };
export class StillContextFlow extends LitElement {
  static properties = { client: { attribute: false }, action: { type: String }, suggestedTarget: { type: String } };
  declare client: StillClient;
  action = '';
  suggestedTarget = '';
  private selectedIdea = '';
  private file:File|null = null;
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
    if (!this.targetId && this.action!=='compose') {
      const targets=ideaActionTargets(this.client.projection,this.client.position,this.action);
      this.selectedIdea=targets.some(b=>b.id===this.suggestedTarget)?this.suggestedTarget:targets.length===1?targets[0].id:'';
      this.phase='select-idea';this.requestUpdate();return;
    }
    if(this.action==='supply-reference'){this.phase='supply';this.requestUpdate();return;}
    if (this.action === 'compose') {
      const block = this.client.projection.blocks.find(b => b.id === this.targetId);
      this.application = value((block?.properties.context_group as Record<string,unknown>)?.application) || 'isolate';
      this.members = this.client.projection.blockRelations.filter(r=>!r.removed && r.fromBlockId===this.targetId && isContextCompositionRelation(r.kind)).sort((a,b)=>Number(a.properties.member_order??0)-Number(b.properties.member_order??0)).map(r=>r.toBlockId);
      this.compositionBaseline=JSON.stringify([this.members,this.application]);this.phase = 'compose'; this.requestUpdate();
    } else {
      this.flow = new ContextWorkflow(this.client,this.action==='split-context'?'decompose':'research',this.action==='find-references'?'references':'research');
      if(this.flow.kind==='research'){const block=this.client.projection.blocks.find(b=>b.id===this.targetId);this.query=String(block?.properties.text??block?.handle??'').slice(0,140);}
      void this.run(async()=>{await this.flow.resume();this.phase=this.flow.preview?'review':'start'; if(this.flow.status==='applied') this.phase='completed';});
    }
  }
  private focusKey = '';
  protected updated() { this.dispatchEvent(new Event('workflow-toolbar-change',{bubbles:true})); const key=`${this.phase}:${this.index}`; if(key===this.focusKey)return;this.focusKey=key; const heading=this.querySelector('h1') as HTMLElement|null;if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});} }
  private done() { this.dispatchEvent(new CustomEvent('context-done',{bubbles:true})); }
  private back() { this.dispatchEvent(new CustomEvent('context-back',{bubbles:true})); }
  private command(label:string,run:()=>void,primary=false,disabled=false):WorkflowAction { return {id:`workflow:${this.phase}:${label.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`,label,run:()=>{if(!this.busy&&!this.composing&&!disabled)run();},variant:primary?'primary':'ghost',disabled:this.busy||this.composing||disabled}; }
  get toolbar():WorkflowToolbar {return {actions:this.commands(),status:this.busy?'Working…':!this.flow&&!['compose','supply-reference'].includes(this.action)&&this.phase!=='select-idea'?'Loading…':''};}
  private commands():WorkflowAction[] {
    const back=()=>this.command('Back',()=>this.back());
    if(this.phase==='select-idea')return [this.command('Continue',()=>this.dispatchEvent(new CustomEvent('context-select',{bubbles:true,detail:this.selectedIdea})),true,!this.selectedIdea),back()];
    if(this.phase==='supply')return [this.command(this.client.hasUnconfirmedWrite?'Check save':'Attach file',()=>void this.run(()=>this.supplyReference()),true,!this.rights||!this.file),back()];
    if(this.action==='compose'){
      if(this.phase==='compose-review')return [this.command(this.client.hasUnconfirmedWrite?'Check save':'Save group',()=>void this.run(async()=>{if(!this.client.hasUnconfirmedWrite)await this.guardSource();await this.client.append(this.plan);this.done();}),true),this.command('Back',()=>{this.phase='compose';this.requestUpdate();},false,this.client.hasUnconfirmedWrite)];
      if(this.phase==='compose-behavior')return [this.command('Preview',()=>void this.run(async()=>{await this.guardSource();this.plan=compositionPlan(this.client.projection,this.targetId,this.members,this.application);this.phase='compose-review';}),true),this.command('Back',()=>{this.phase='compose';this.requestUpdate();})];
      return [this.command('Add',()=>{this.members=[...this.members,this.member];this.member='';this.requestUpdate();},false,!this.member||this.members.length>=40),this.command('Remove last',()=>{this.members=this.members.slice(0,-1);this.requestUpdate();},false,!this.members.length),this.command('Continue',()=>{this.phase='compose-behavior';this.requestUpdate();},true),back()];
    }
    const flow=this.flow;if(!flow)return [];
    if(this.phase==='source-refine')return [this.command(this.client.hasUnconfirmedWrite?'Check save':'Save',()=>void this.run(async()=>{if(!this.client.hasUnconfirmedWrite)await this.guardSource();await this.client.append([{type:'BlockPropertyEdited',payload:{block_id:this.targetId,property_path:'text',old_value:this.sourceBase,new_value:this.sourceDraft}}]);this.done();}),true),this.command('Keep original',()=>this.done(),false,this.client.hasUnconfirmedWrite)];
    if(this.phase==='completed')return [this.command('Edit shared direction',()=>{this.reviewSource();this.requestUpdate();}),this.command('Explore again',()=>void this.run(async()=>{await flow.dismiss();this.phase='start';}),true),this.command('Close',()=>this.back())];
    if(this.phase==='start') {
      const checking=!!flow.quote&&flow.quote.status!=='quoted';
      const label=checking?'Check analysis':flow.kind==='decompose'?'Split idea':this.action==='find-references'?'Find reference':'Research idea';
      return [this.command(label,()=>void this.run(()=>this.analyze()),true,!checking&&(this.query.length>140||flow.kind==='research'&&!this.query.trim())),back()];
    }
    if(this.phase==='intake'&&this.intake?.research)return [this.command(this.client.hasUnconfirmedWrite?'Check save':'Add reference',()=>void this.run(()=>this.file?this.supplyReference():this.importReference()),true,!this.rights||!this.file&&!this.intake?.research?.imageUrl),this.command('Back',()=>{this.phase='candidates';this.requestUpdate();},false,this.client.hasUnconfirmedWrite)];
    if(this.phase==='review'&&flow.preview)return [this.command(flow.status==='applying'?'Check save':'Apply',()=>void this.run(()=>this.apply()),true,flow.stale),...(flow.status!=='applying'?[this.command('Change selection',()=>void this.run(async()=>{await flow.dismiss();this.phase=flow.candidates.length?'candidates':'start';}))]:[]),this.command('Close',()=>this.back())];
    const candidate=flow.candidates[this.index],r=candidate?.research,proposal=candidate?.proposal;
    if(!candidate)return [this.command('Close',()=>this.back())];
    const reference=r?.type==='reference'&&r.area==='learned'&&!r.blockId;
    return [reference?this.command('Add reference',()=>{this.intake=candidate;this.file=null;this.rights=false;this.referenceEvents=null;this.phase='intake';this.requestUpdate();},true):this.command(candidate.included?'Deselect':'Select',()=>{candidate.included=!candidate.included;this.requestUpdate();},true,!!proposal&&(!candidate.text.trim()||candidate.text.length>1800)),this.command('Next',()=>{this.index=(this.index+1)%flow.candidates.length;this.requestUpdate();},false,flow.candidates.length<2),this.command(`Review (${flow.candidates.filter(c=>c.included).length})`,()=>void this.run(()=>this.review()),false,!flow.candidates.some(c=>c.included)),this.command('Close',()=>this.back())];
  }
  private async run(work:()=>Promise<void>) { if(this.busy||this.composing)return; this.busy=true;this.error='';this.requestUpdate();try {await work();}catch(e){this.error=e instanceof Error?e.message:'This step was interrupted.';}finally{this.busy=false;this.requestUpdate();} }
  private field(label:string,text:string,change:(v:string)=>void,rows=4,disabled=false) { return html`<en-textarea label=${label} .value=${live(text)} rows=${rows} .disabled=${disabled||this.busy||this.client.hasUnconfirmedWrite} @en-input=${(e:CustomEvent<{value:string;isComposing:boolean}>)=>{change(e.detail.value);this.composing=e.detail.isComposing;if(!this.composing)this.requestUpdate();}}></en-textarea>`; }
  private async analyze() { await this.flow.startAnalysis(this.query); this.phase='candidates';this.index=0; }
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
  private filePicker() {return html`<input class="reference-file-input" type="file" hidden accept=".png,.jpg,.jpeg,.webp,.mp4,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm,.pdf,.txt,.md,.csv,.json,.docx,.pptx,.xlsx,.glb" ?disabled=${this.busy||!!this.referenceEvents||this.client.hasUnconfirmedWrite} @change=${(e:Event)=>{this.file=(e.target as HTMLInputElement).files?.[0]??null;this.rights=false;this.requestUpdate();}}><en-button variant="secondary" .disabled=${this.busy||!!this.referenceEvents||this.client.hasUnconfirmedWrite} @click=${()=>this.querySelector<HTMLInputElement>('.reference-file-input')?.click()}>${this.file?'Change file':'Choose file'}</en-button>${this.file?html`<p>${this.file.name} · ${(this.file.size/1024/1024).toFixed(1)} MB</p>`:nothing}<p class="caption">Images and documents ≤12 MB · audio and MP4 ≤25 MB · GLB ≤64 MB</p><en-checkbox label="I can use this file. It contains no sensitive personal data." .checked=${this.rights} .disabled=${this.busy||!!this.referenceEvents} @en-change=${(e:CustomEvent<{proposed:boolean}>)=>{this.rights=e.detail.proposed;this.requestUpdate();}}></en-checkbox>`;}
  private async supplyReference(){
    if(!this.file||!this.rights)throw new Error('Choose a file and confirm its permissions.');
    const check=this.client.hasUnconfirmedWrite?await this.client.verifyScope():await this.guardSource();
    if(this.scopeKey!==this.client.scopeKey||this.targetId!==this.client.position.blockId)throw new Error('Reopen the original idea.');
    if(!this.referenceEvents){
      const form=new FormData();form.append('file',this.file);form.append('rightsConfirmed','true');form.append('nonSensitiveConfirmed','true');
      const response=await fetch('/api/media',{method:'POST',credentials:'same-origin',body:form});
      const media=await response.json();if(!response.ok)throw new ApiError(response.status,media);check();
      const target=this.client.projection.blocks.find(b=>b.id===this.targetId);if(!target)throw new Error('Idea unavailable.');
      this.referenceEvents=suppliedReferenceEvents(target,this.client.projection,media,this.intake??undefined);
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
    if(this.phase==='select-idea'){const targets=ideaActionTargets(this.client.projection,this.client.position,this.action);return html`<h1>Choose an idea</h1><en-select label="Idea" .value=${this.selectedIdea} @en-change=${(e:CustomEvent<{proposed:string}>)=>{this.selectedIdea=e.detail.proposed;this.requestUpdate();}}><en-select-option value="">Choose an idea</en-select-option>${targets.map(b=>html`<en-select-option value=${b.id}>${b.handle}</en-select-option>`)}</en-select>${this.selectedIdea?html`<p class="context-preview">${value(targets.find(b=>b.id===this.selectedIdea)?.properties.text)}</p>`:nothing}`;}
    if(this.phase==='supply')return html`<span class="eyebrow">${block?.handle}</span><h1>Supply reference</h1><p class="context-preview">${value(block?.properties.text)}</p>${this.filePicker()}`;
    if(this.action==='compose') {
      if(this.phase==='compose-behavior')return html`<h1>Group behavior</h1><en-select class="select-label" label="Relationship" .value=${this.application} @en-change=${(e: CustomEvent<{proposed:string;value:string}>)=>{this.application=e.detail.proposed;this.requestUpdate();}}><en-select-option value="isolate">Focused group</en-select-option><en-select-option value="co_locate">Same setting</en-select-option><en-select-option value="ordered">In order</en-select-option><en-select-option value="recur">Recurring</en-select-option></en-select>`;
      return this.renderCompose();
    }
    const flow=this.flow;if(!flow)return html`<p>Loading…</p>`;
    if(this.phase==='source-refine')return html`<h1>Shared direction</h1><p>Ideas saved. Remove repeated details; keep shared constraints.</p>${this.field('Text',this.sourceDraft,v=>this.sourceDraft=v)}<div class="change-review">${flow.preview?.changes.filter(c=>c.kind==='create').map(c=>html`<p><strong>${c.label}</strong> · ${c.text}</p>`)}</div>`;
    if(this.phase==='completed')return html`<h1>Saved</h1>`;
    if(this.phase==='start')return html`<span class="eyebrow">${block?.handle}</span><h1>${flow.kind==='decompose'?'Split idea':this.action==='find-references'?'Find reference':'Research idea'}</h1><p class="context-preview">${value(block?.properties.text)}</p><p>${flow.kind==='decompose'?'Review smaller ideas. Keep what helps.':this.action==='find-references'?'Find files that make this idea more precise.':'Review sourced details to enrich this idea.'}</p>${flow.kind==='research'?this.field('Public search topic · 140 characters max',this.query,v=>this.query=v,2,!!flow.quote&&flow.quote.status!=='quoted'):nothing}`;
    if(this.phase==='intake'&&this.intake?.research) {
      const r=this.intake.research;
      return html`<h1>${r.label}</h1>${r.imageUrl?stillImage(r.imageUrl,r.label,undefined,{className:'reference-study',loading:'eager'}):nothing}<p>${r.attribution} · ${r.license}</p><p>Private copy with source and credit. Direct media guidance stays off.</p>${!r.imageUrl?html`<p>Open the source, obtain a permitted file, then attach it here.</p><a href=${sourceURL(r.sourceUrl)} target="_blank" rel="noopener noreferrer">Open source</a>${this.filePicker()}`:nothing}${r.imageUrl?html`<en-checkbox class="check" label="I can use this image. It contains no sensitive personal data." .checked=${this.rights} .disabled=${this.busy||!!this.referenceEvents} @en-change=${(e: CustomEvent<{proposed:boolean}>)=>{this.rights=e.detail.proposed;this.requestUpdate();}}></en-checkbox>`:nothing}`;
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
