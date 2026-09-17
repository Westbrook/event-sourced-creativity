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
  private plan: EventInput[] = [];
  private revision = '';
  private scopeKey = '';
  private targetId = '';
  private rights = false;
  private intake: IdeaCandidate | null = null;
  private uploadUncertain = false;
  private referenceEvents: EventInput[] | null = null;
  private beforeUnload = (e: BeforeUnloadEvent) => { if (this.busy || this.flow?.quote?.status === 'uncertain' || this.flow?.status === 'applying' || this.phase !== 'start') { e.preventDefault(); e.returnValue = ''; } };
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
      this.phase = 'compose'; this.requestUpdate();
    } else {
      this.flow = new ContextWorkflow(this.client,this.action==='split-context'?'decompose':'research');
      void this.run(async()=>{await this.flow.resume();this.phase=this.flow.preview?'review':'start'; if(this.flow.status==='applied') this.phase='completed';});
    }
  }
  private focusKey = '';
  protected updated() { const key=`${this.phase}:${this.index}`; if(key===this.focusKey)return;this.focusKey=key; const heading=this.querySelector('h1') as HTMLElement|null;if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});} }
  private done() { this.dispatchEvent(new CustomEvent('context-done',{bubbles:true})); }
  private back() { this.dispatchEvent(new CustomEvent('context-back',{bubbles:true})); }
  private button(label:string,action:()=>void,primary=false,disabled=false) { return html`<en-button variant=${primary?'primary':'ghost'} .disabled=${this.busy||this.composing||disabled} @click=${action}>${label}</en-button>`; }
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
    return html`<div class="analysis-input"><span class="eyebrow">Context shared privately for this analysis</span>${entries.map(entry=>html`<p>${value(entry.text)}</p>`)}</div>`;
  }
  private async guardSource() {
    const check=await this.client.verifyScope(); await this.client.refresh();check();
    if(this.scopeKey!==this.client.scopeKey||this.targetId!==this.client.position.blockId||this.revision!==documentSource(this.client.projection,this.client.position.documentId).revision)throw new Error('The context changed during this review. Return to the document and review the current version.');
    return check;
  }
  private async importReference() {
    if(!this.intake?.research||!this.rights)throw new Error('Confirm permission to use this reference.');
    const check=this.client.hasUnconfirmedWrite?await this.client.verifyScope():await this.guardSource(), candidate=this.intake.research;
    if(this.scopeKey!==this.client.scopeKey||this.targetId!==this.client.position.blockId)throw new Error('Return to the original context to check this save.');
    const uploadKey=`still:reference-upload:${this.scopeKey}:${this.targetId}:${this.intake.selection.executionId}:${this.intake.selection.proposalId}`;
    if(!this.referenceEvents) {
      let pending=this.uploadUncertain;try{pending ||= sessionStorage.getItem(uploadKey)==='pending';}catch{}
      if(pending)throw new Error('The earlier image upload is unconfirmed. It has not been repeated. Check your media in Forma before importing this reference again.');
      const url=new URL(candidate.imageUrl??'');
      if(url.protocol!=='https:'||url.hostname!=='upload.wikimedia.org'||url.username||url.password||!candidate.license)throw new Error('This candidate cannot be acquired automatically.');
      const response=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw new Error('The source image could not be acquired. Open its source to inspect availability.');
      if(Number(response.headers.get('content-length')??0)>12*1024*1024)throw new Error('The reference exceeds the image upload limit.');
      const blob=await response.blob();check();
      if(!['image/png','image/jpeg','image/webp'].includes(blob.type)||blob.size>12*1024*1024)throw new Error('The reference must be a PNG, JPEG, or WebP below 12 MB.');
      await this.guardSource();
      const form=new FormData();form.append('file',blob,`reference.${blob.type==='image/jpeg'?'jpg':blob.type.split('/')[1]}`);form.append('rightsConfirmed','true');form.append('nonSensitiveConfirmed','true');
      this.uploadUncertain=true;try{sessionStorage.setItem(uploadKey,'pending');}catch{}
      const uploaded=await fetch('/api/media',{method:'POST',credentials:'same-origin',body:form});
      const media=await uploaded.json();if(!uploaded.ok){if([400,401,403,413,415,422,429].includes(uploaded.status)){this.uploadUncertain=false;try{sessionStorage.removeItem(uploadKey);}catch{}}throw new ApiError(uploaded.status,media);}check();
      if(!value(media.url).startsWith('/api/media/')||!media.contentHash)throw new Error('The acquired media receipt could not be verified.');
      const target=this.client.projection.blocks.find(b=>b.id===this.targetId);if(!target)throw new Error('The reference target is unavailable.');
      this.referenceEvents=acquiredReferenceEvents(target,this.client.projection,this.intake,media);
      this.uploadUncertain=false;try{sessionStorage.removeItem(uploadKey);}catch{}
    }
    if(!this.client.hasUnconfirmedWrite)await this.guardSource();
    await this.client.append(this.referenceEvents);this.done();
  }
  private renderCompose() {
    const blocks=this.client.projection.blocks, parent=blocks.find(b=>b.id===this.targetId);
    const choices=blocks.filter(b=>editableIdea(b)&&b.id!==this.targetId&&!this.members.includes(b.id));
    return html`<span class="eyebrow">${parent?.handle}</span><h1>Ideas, together.</h1><p>Keep each idea editable. Arrange members in the order you want; removing a member leaves its block in the document.</p><ol class="assembly-list">${this.members.map(id=>html`<li><strong>${blocks.find(b=>b.id===id)?.handle}</strong><p>${value(blocks.find(b=>b.id===id)?.properties.text)}</p></li>`)}</ol>${this.phase==='compose-review'?html`<p class="cost-note">${this.application==='ordered'?'Read these ideas in this order.':this.application==='recur'?'Repeat these ideas together.':this.application==='co_locate'?'Bring these ideas into the same setting.':'Keep this group focused on its own target.'} The source thought and member identities remain intact.</p><div class="form-actions">${this.button(this.client.hasUnconfirmedWrite?'Check original save':'Use this arrangement',()=>void this.run(async()=>{if(!this.client.hasUnconfirmedWrite)await this.guardSource();await this.client.append(this.plan);this.done();}),true)}${this.button('Back',()=>{this.phase='compose';this.requestUpdate();},false,this.client.hasUnconfirmedWrite)}</div>`:html`<label class="select-label">Add a member<select .value=${this.member} @change=${(e:Event)=>{this.member=(e.target as HTMLSelectElement).value;this.requestUpdate();}}><option value="">Choose an idea</option>${choices.map(b=>html`<option value=${b.id}>${b.handle}</option>`)}</select></label><div class="form-actions">${this.button('Add this idea',()=>{this.members=[...this.members,this.member];this.member='';this.requestUpdate();},false,!this.member||this.members.length>=40)}${this.button('Remove last member',()=>{this.members=this.members.slice(0,-1);this.requestUpdate();},false,!this.members.length)}${this.button('Review arrangement',()=>{this.phase='compose-behavior';this.requestUpdate();},true)}${this.button('Back',()=>this.back())}</div>`}`;
  }
  private renderBody() {
    const block=this.client?.projection.blocks.find(b=>b.id===this.targetId);
    if(this.action==='compose') {
      if(this.phase==='compose-behavior')return html`<h1>How do these ideas travel?</h1><label class="select-label">Relationship<select .value=${this.application} @change=${(e:Event)=>{this.application=(e.target as HTMLSelectElement).value;this.requestUpdate();}}><option value="isolate">One focused target</option><option value="co_locate">Together in the same setting</option><option value="ordered">In a particular order</option><option value="recur">Recurring together</option></select></label><div class="form-actions">${this.button('Preview',()=>void this.run(async()=>{await this.guardSource();this.plan=compositionPlan(this.client.projection,this.targetId,this.members,this.application);this.phase='compose-review';}),true)}${this.button('Back',()=>{this.phase='compose';this.requestUpdate();})}</div>`;
      return this.renderCompose();
    }
    const flow=this.flow;if(!flow)return html`<p>Opening this thought…</p>`;
    if(this.phase==='source-refine')return html`<h1>What still belongs to the whole?</h1><p>Your smaller ideas are saved. Keep only shared directions here so changing a piece later does not conflict with repeated wording. Preserve any constraints that the pieces do not cover.</p>${this.field('Shared direction',this.sourceDraft,v=>this.sourceDraft=v)}<div class="change-review">${flow.preview?.changes.filter(c=>c.kind==='create').map(c=>html`<p><strong>${c.label}</strong> · ${c.text}</p>`)}</div><div class="form-actions">${this.button(this.client.hasUnconfirmedWrite?'Check original save':'Save shared direction',()=>void this.run(async()=>{if(!this.client.hasUnconfirmedWrite)await this.guardSource();await this.client.append([{type:'BlockPropertyEdited',payload:{block_id:this.targetId,property_path:'text',old_value:this.sourceBase,new_value:this.sourceDraft}}]);this.done();}),true)}${this.button('Keep original wording for now',()=>this.done(),false,this.client.hasUnconfirmedWrite)}</div>`;
    if(this.phase==='completed')return html`<h1>These ideas are part of your work.</h1><p>The previous review was applied. You can start a fresh exploration of this thought.</p><div class="form-actions">${this.button('Review shared wording',()=>{this.reviewSource();this.requestUpdate();})}${this.button('Explore this thought again',()=>void this.run(async()=>{await flow.dismiss();this.phase='start';}),true)}${this.button('Back to document',()=>this.back())}</div>`;
    if(this.phase==='start')return html`<span class="eyebrow">${block?.handle}</span><h1>${flow.kind==='decompose'?'Room for each idea.':this.action==='find-references'?'Give the idea a reference.':'Follow the question.'}</h1><p class="context-preview">${value(block?.properties.text)}</p><p>${flow.kind==='decompose'?'Separate decisions you want to edit, reuse, research, or replace independently. You choose the useful pieces; the original remains their shared source.':'Find useful connections and grounded details. A public subject also searches the web and licensed image references.'}</p>${flow.kind==='research'?this.field('Public research subject · optional, up to 140 characters',this.query,v=>this.query=v,2):nothing}<div class="form-actions">${this.button('Review analysis cost',()=>void this.run(()=>this.prepare()),true,this.query.length>140)}${this.button('Back',()=>this.back())}</div>`;
    if(this.phase==='quote') {
      const q=flow.quote;
      if(!q)return html`<h1>A fresh review is needed.</h1>${this.button('Review current cost',()=>void this.run(()=>this.prepare()),true)}${this.button('Back',()=>this.back())}`;
      return html`<span class="eyebrow">${q.provider} · ${q.models.join(', ')}</span><h1>${q.status==='quoted'?'A little exploration.':'Check the original exploration.'}</h1><p>Maximum cost: $${(q.maximumMicrousd/1e6).toFixed(4)} · ${q.providerCalls} ${q.providerCalls===1?'provider call':'provider calls'} · ${q.searchCalls} ${q.searchCalls===1?'search':'searches'}</p><p>${q.publicQuery?`Public search subject: ${q.publicQuery}`:'No public web query. Private context analysis only.'}</p>${this.privateInput()}${!q.providerAvailable?html`<p>Analysis is unavailable for this account in this environment.</p>`:nothing}<div class="form-actions">${this.button(q.status==='quoted'?'Approve analysis':'Check original analysis',()=>void this.run(()=>this.analyze()),true,q.status==='quoted'&&(!q.providerAvailable||q.canExecute===false))}${this.button('Back',()=>this.back())}</div>`;
    }
    if(this.phase==='intake'&&this.intake?.research) {
      const r=this.intake.research;
      return html`<h1>${r.label}</h1>${r.imageUrl?html`<img class="reference-study" src=${r.imageUrl} referrerpolicy="no-referrer" alt=${r.label}/>`:nothing}<p>${r.attribution} · ${r.license}</p><p>This adds an private copy of this preview as a context reference, with its source and attribution. It does not enable pixel conditioning.</p><label class="check"><input type="checkbox" .checked=${this.rights} .disabled=${this.busy||!!this.referenceEvents} @change=${(e:Event)=>{this.rights=(e.target as HTMLInputElement).checked;this.requestUpdate();}}/> I have permission to use this image and it contains no sensitive personal information.</label><div class="form-actions">${this.button(this.client.hasUnconfirmedWrite?'Check original save':'Add reference',()=>void this.run(()=>this.importReference()),true,!this.rights)}${this.button('Back',()=>{this.phase='candidates';this.requestUpdate();},false,this.client.hasUnconfirmedWrite)}</div>`;
    }
    if(this.phase==='review'&&flow.preview) return html`<span class="eyebrow">${flow.preview.blockCount} ${flow.preview.blockCount===1?'block':'blocks'} · ${flow.preview.relationCount} ${flow.preview.relationCount===1?'relationship':'relationships'}</span><h1>See what changes.</h1>${flow.preview.changes.map(change=>html`<div class="change-review"><span class="eyebrow">${change.kind} · ${change.label}</span><p>${change.kind==='group'?({isolate:'One focused target',co_locate:'Together in the same setting',ordered:'In this order',recur:'Recurring together'}[change.text]??change.text):change.text}</p></div>`)}<p>The original thought stays intact. Refine it after reviewing the new pieces if they repeat its instructions.</p>${flow.stale?html`<p>This saved review is out of date. Return to the document to start a fresh review.</p>`:nothing}<div class="form-actions">${this.button(flow.status==='applying'?'Check original save':'Use these ideas',()=>void this.run(()=>this.apply()),true,flow.stale)}${flow.status!=='applying'?this.button('Change selection',()=>void this.run(async()=>{await flow.dismiss();this.phase=flow.candidates.length?'candidates':'start';})):nothing}${this.button('Back to document',()=>this.back())}</div>`;
    const candidate=flow.candidates[this.index],r=candidate?.research,proposal=candidate?.proposal;
    if(!candidate)return html`<h1>No new pieces this time.</h1><p>A coherent idea can stay together. Try a more specific research subject or continue shaping this thought.</p>${this.button('Back to document',()=>this.back())}`;
    const reference=r?.type==='reference'&&r.area==='learned'&&!r.blockId,source=sourceURL(r?.sourceUrl);
    return html`<span class="eyebrow">${this.index+1} / ${flow.candidates.length} · ${candidate.included?'Kept for review':reference?'Reference candidate':'Available idea'}</span><h1>${proposal?.label??r?.label}</h1>${reference&&r?.imageUrl?html`<img class="reference-study" src=${r.imageUrl} referrerpolicy="no-referrer" alt=${r.label}/>`:nothing}${proposal?this.field('This idea',candidate.text,v=>candidate.text=v):html`<p class="context-preview">${candidate.text}</p>`}${proposal?.sourceExcerpt?html`<blockquote>${proposal.sourceExcerpt}</blockquote>`:nothing}${r?.reason?html`<p>${r.reason}</p>`:nothing}${r?.license?html`<p class="caption">${r.attribution} · ${r.license}</p>`:nothing}<div class="form-actions">${reference?this.button('Acquire this reference',()=>{this.intake=candidate;this.rights=false;this.referenceEvents=null;this.phase='intake';this.requestUpdate();},true):this.button(candidate.included?'Set this idea aside':'Keep this idea',()=>{candidate.included=!candidate.included;this.requestUpdate();},true,!!proposal&&(!candidate.text.trim()||candidate.text.length>1800))}${this.button('Next idea',()=>{this.index=(this.index+1)%flow.candidates.length;this.requestUpdate();},false,flow.candidates.length<2)}${source?html`<a class="source-link" href=${source} target="_blank" rel="noopener noreferrer">Open source ↗</a>`:nothing}${this.button(`Review ${flow.candidates.filter(c=>c.included).length} kept`,()=>void this.run(()=>this.review()),false,!flow.candidates.some(c=>c.included))}${this.button('Back to document',()=>this.back())}</div>`;
  }
  render() { return html`<section class="form-page context-flow" aria-busy=${this.busy}>${this.renderBody()}${this.error?html`<p class="context-error" role="alert">${this.error}</p>`:nothing}${this.busy?html`<p role="status">A moment…</p>`:nothing}</section>`; }
}
if(!customElements.get('still-context-flow'))customElements.define('still-context-flow',StillContextFlow);
