import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';
import { repeat } from 'lit/directives/repeat.js';
import './vendor/tokens/default.css';
import './vendor/elements/define/button.js';
import './vendor/elements/define/toolbar.js';
import './vendor/elements/define/textarea.js';
import './style.css';
import { ACTIONS, eligibleActions, selectActions, type Action } from './decisions.ts';
import { documentSource } from './context.ts';
import { api, ApiError, StillClient, type GenerationDraft } from './client.ts';
import { documentArtifactRevision, model3dArtifactMediaFile, parseDocumentArtifactContent, type DocumentArtifact } from '../model/document-artifacts.ts';
import { estimateModel3dCostMicrousd } from '../model/model3d.ts';

const REPORT_URL = 'http://127.0.0.1:4187';
const FORMATS: Record<string, string> = { image: 'Image', short_story: 'Short story', scene: 'Scene', slides: 'Presentation', storyboard: 'Storyboard', video: 'Video', audio: 'Audio', model3d: '3D model' };
const blockKinds = ['direction', 'subject', 'environment', 'style', 'exclusion', 'message', 'material', 'audience', 'emotion', 'composition'];
const activeJobs = new Set(['queued', 'running', 'committing']);
const text = (v: unknown) => typeof v === 'string' ? v : '';
const safeMedia = (url: string | null | undefined) => url?.startsWith('/api/media/') ? url : '';

export class StillApp extends LitElement {
  private client = new StillClient();
  private loading = true;
  private busy = false;
  private error = '';
  private notice = '';
  private mode = '';
  private titleDraft = '';
  private bodyDraft = '';
  private kindDraft = 'direction';
  private pendingBlock: ReturnType<StillClient['blockEvent']> | null = null;
  private editBase: { text?: string; revision?: number; title?: string; item?: number } = {};
  private composing = false;
  private dockObserver = new ResizeObserver(entries => { const h = entries[0]?.contentRect.height ?? 140; this.style.setProperty('--dock-height', `${h + 70}px`); });
  private choice = '';
  private page = 0;
  private get itemIndex() { return this.client.position.itemIndex ?? 0; }
  private set itemIndex(value: number) { this.client.position.itemIndex = value; }
  private suggestions: Action[] = [];
  private decisionSource = 'fallback';
  private decisionTicket = 0;
  private decisionTimer = 0;
  private pollTimer = 0;
  private generation: GenerationDraft | null = null;
  private generationGate: { key: string; message: string } | null = null;
  private ownership = false;
  private providerConsent = false;
  private disposed = false;
  private readonly popstate = () => { if (!this.mode) { this.readRoute(); this.changed(); this.decide(); } };
  createRenderRoot() { return this; }
  connectedCallback() {
    super.connectedCallback(); this.disposed = false;
    this.client.onChange = () => { if (this.client.recoveredWrite) { this.notice = 'Your earlier save is confirmed. The saved work is available here.'; this.client.recoveredWrite = false; } this.changed(); };
    window.addEventListener('popstate', this.popstate);
    window.addEventListener('beforeunload', this.beforeUnload);
    void this.run(async () => { await this.client.load(); this.readRoute(); this.loading = false; this.decide(); this.poll(); });
  }
  disconnectedCallback() { super.disconnectedCallback(); this.disposed = true; this.dockObserver.disconnect(); clearTimeout(this.pollTimer); clearTimeout(this.decisionTimer); window.removeEventListener('popstate', this.popstate); window.removeEventListener('beforeunload', this.beforeUnload); }
  private beforeUnload = (e: BeforeUnloadEvent) => { if (this.client.hasUnconfirmedWrite || this.generation?.attempted || this.mode && (this.bodyDraft || this.titleDraft)) { e.preventDefault(); e.returnValue = ''; } };
  private changed() { this.requestUpdate(); }
  protected updated() { const dock = this.querySelector('.action-dock'); this.dockObserver.disconnect(); if (dock) this.dockObserver.observe(dock); }
  private focusContent() { void this.updateComplete.then(() => { const target = this.querySelector('en-textarea, select, main h1') as HTMLElement | null; if(target) { if(target.tagName === 'H1') target.tabIndex = -1; target.focus(); } }); }
  private async run(work: () => Promise<void>) {
    if (this.busy || this.composing) return;
    this.busy = true; this.error = ''; this.changed();
    try { await work(); } catch (error) { this.error = error instanceof Error ? error.message : 'Something interrupted this step.'; }
    finally { this.busy = false; this.loading = false; this.changed(); }
  }
  private readRoute() {
    const q = new URL(location.href).searchParams;
    const projectId = q.get('project') ?? this.client.session?.projectContext?.projectId ?? '';
    const documentId = q.get('document') ?? '';
    this.client.position = { ...this.client.position, projectId, documentId, outputId: q.get('work') ?? '', blockId: '', view: q.has('work') ? 'artifact' : documentId ? 'document' : projectId ? 'documents' : 'projects' };
    const p = this.client.projection;
    if (projectId && !p.projects.some(x => x.id === projectId) || documentId && !p.documents.some(x => x.id === documentId && !x.removed)) { this.error = 'That work is unavailable in this workspace.'; this.client.position.projectId = this.client.session?.projectContext?.projectId ?? ''; this.client.position.documentId = ''; this.client.position.view = this.client.position.projectId ? 'documents' : 'projects'; }
  }
  private navigate(view: string, ids: Partial<StillClient['position']> = {}) {
    ++this.decisionTicket; this.mode = ''; this.page = 0; this.itemIndex = 0; this.error = ''; this.generationGate = null;
    this.client.position = { ...this.client.position, blockId: '', outputId: '', ...ids, view };
    const p = this.client.position, url = new URL(location.href);
    for (const [key, value] of [['project', p.projectId], ['document', p.documentId], ['work', p.outputId]]) value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
    history.pushState(null, '', url); this.changed(); this.focusContent(); this.decide();
    if (p.documentId) void this.client.pollJobs().catch(() => {});
  }
  private candidates() { return eligibleActions(this.client.projection, this.client.position, this.client.abilities); }
  private decide() {
    clearTimeout(this.decisionTimer); const ticket = ++this.decisionTicket;
    const candidates = this.candidates(); this.suggestions = selectActions(candidates, this.client.position); this.decisionSource = 'fallback'; this.changed();
    if (!this.client.session?.policy.accepted || this.mode) return;
    this.decisionTimer = window.setTimeout(async () => {
      const snapshot = JSON.stringify(this.client.position), head = this.client.head;
      try {
        const result = await api<{ actions: Action[]; source: string; head: number }>('/api/still/decision', this.client.position);
        if (ticket !== this.decisionTicket || snapshot !== JSON.stringify(this.client.position) || head !== this.client.head || this.mode || this.disposed) return;
        if (this.querySelector('.action-dock')?.contains(document.activeElement)) return; // Never move the focused action.
        if (Array.isArray(result.actions) && result.actions.length && result.head === head) { const allowed = new Set(this.candidates().map(a => a.id)); this.suggestions = result.actions.filter(a => allowed.has(a.id)).slice(0, 4); this.decisionSource = result.source; this.changed(); }
      } catch { /* Local contextual actions remain fully usable. */ }
    }, 700);
  }
  private poll() {
    this.pollTimer = window.setTimeout(async () => {
      try { if (!this.busy && !document.hidden && this.client.session?.policy.accepted) { if (this.client.position.documentId) await this.client.pollJobs(); else await this.client.refresh(); } } catch { /* Keep saved work visible; explicit refresh reports errors. */ }
      if (!this.disposed) this.poll();
    }, this.client.jobs.some(j => activeJobs.has(j.status)) ? 2000 : 12000);
  }
  private button(label: string, action: () => void, primary = false, disabled = false) { return html`<en-button variant=${primary ? 'primary' : 'ghost'} .disabled=${this.busy || this.composing || disabled} @click=${action}>${label}</en-button>`; }
  private field(label: string, value: string, change: (v: string) => void, rows = 3, placeholder = '') { return html`<en-textarea label=${label} .value=${live(value)} rows=${rows} placeholder=${placeholder} .disabled=${this.busy || this.client.hasUnconfirmedWrite} @en-input=${(e: CustomEvent<{ value: string; isComposing: boolean }>) => { change(e.detail.value); this.composing = e.detail.isComposing; if (!this.composing) this.changed(); }}></en-textarea>`; }
  private closeMode() { this.mode = ''; this.bodyDraft = ''; this.titleDraft = ''; this.generationGate = null; this.generation = null; this.error = ''; this.decide(); this.focusContent(); }
  private begin(mode: string) {
    this.pendingBlock = null; this.mode = mode; ++this.decisionTicket; clearTimeout(this.decisionTimer); this.error = ''; this.choice = ''; this.titleDraft = ''; this.bodyDraft = ''; this.kindDraft = 'direction';
    if (mode === 'actions') this.choice = this.candidates()[0]?.id ?? '';
    if (mode === 'edit-block') { const block = this.client.projection.blocks.find(b => b.id === this.client.position.blockId); this.bodyDraft = text(block?.properties.text); this.titleDraft = block?.handle ?? ''; this.kindDraft = block?.type ?? 'message'; this.editBase = { text: text(block?.properties.text) };  }
    if (mode === 'rename') { this.titleDraft = this.client.projection.documentTitle; this.editBase = { title: this.titleDraft }; }
    if (mode === 'intent') this.bodyDraft = this.client.position.intent;
    if (mode === 'surprise') { this.mode = 'add-context'; this.titleDraft = 'Another possibility'; this.kindDraft = 'style'; this.bodyDraft = ''; }
    if (mode === 'clarify') { this.mode = 'add-context'; this.titleDraft = 'The heart of it'; this.kindDraft = 'direction'; }
    if (mode === 'edit-artifact') { const a = this.client.projection.artifacts.find(x => x.id === this.client.position.outputId); const content = parseDocumentArtifactContent(a?.contentRef ? this.client.content[a.contentRef] : undefined); this.editBase = { revision: a ? documentArtifactRevision(this.client.events, a.id) : 0, ...(a && ['slides','storyboard'].includes(a.kind) ? {item:this.itemIndex} : {}) }; this.bodyDraft = this.editBase.item !== undefined ? (content?.items[this.itemIndex]?.body ?? a?.items[this.itemIndex]?.body ?? '') : content?.content_markdown ?? a?.items.map(i => `## ${i.title}\n\n${i.body}`).join('\n\n') ?? ''; }
    this.changed(); this.focusContent();
  }
  private choose(id: string) {
    if (this.busy || this.composing) return;
    this.client.position.recentActions = [...this.client.position.recentActions, id].slice(-12);
    if (id === 'projects') return this.navigate('projects', { projectId: '', documentId: '' });
    if (id === 'documents') return this.navigate('documents', { documentId: '' });
    if (id === 'context') return this.navigate('document');
    if (id === 'results') return this.navigate('results');
    if (id === 'export') { void this.run(() => this.exportWork()); return; }
    if (['lock', 'unlock', 'toggle-context'].includes(id)) {
      void this.run(async () => { const b = this.client.projection.blocks.find(x => x.id === this.client.position.blockId); if (!b) return; await this.client.append([{ type: id === 'toggle-context' ? 'BlockWeightSet' : id === 'lock' ? 'BlockLocked' : 'BlockUnlocked', payload: { block_id: b.id, ...(id === 'toggle-context' ? { weight: Number(b.properties.weight ?? 1) > 0 ? 0 : .8, previous_weight: b.properties.weight ?? 1 } : {}) } }]); this.notice = 'Context updated.'; this.decide(); }); return;
    }
    if (FORMATS[id]) {
      const p = this.client.projection;
      this.generation = { format: id, prompt: id === 'model3d' ? this.client.model3dAdaptation().prompt : '', ...(id === 'model3d' ? { adaptation: this.client.model3dAdaptation() } : {}), documentId:p.documentId, scopeKey:this.client.scopeKey, itemCount: id === 'slides' ? 6 : id === 'storyboard' ? 4 : 1, tone: '', audience: '', requestId: crypto.randomUUID(), sourceHead: this.client.head, sourceSnapshot: documentSource(p,p.documentId).snapshot, sourceBlockVersions:documentSource(p,p.documentId).sourceBlockVersions, sourceRevision:documentSource(p,p.documentId).revision };
      this.begin('generate'); return;
    }
    this.begin(id);
  }
  private async save() {
    const c = this.client, p = c.projection;
    if (this.mode === 'new-project' || this.mode === 'new-document') {
      if (!this.titleDraft.trim()) throw new Error('Give this idea a name.');
      const ids = this.mode === 'new-project' ? await c.createProject(this.titleDraft.trim(), this.bodyDraft.trim()) : await c.createDocument(this.titleDraft.trim(), this.bodyDraft.trim());
      this.navigate('document', ids);
    } else if (this.mode === 'add-context') {
      if (!this.bodyDraft.trim()) throw new Error('Add a little context first.');
      if (!c.hasUnconfirmedWrite || !this.pendingBlock) { const event = c.blockEvent(this.bodyDraft, this.titleDraft.trim() || 'A thought', this.kindDraft); if(this.pendingBlock) Object.assign(event.payload,{block_id:this.pendingBlock.payload.block_id,position:this.pendingBlock.payload.position}); this.pendingBlock = event; }
      await c.append([this.pendingBlock]); this.closeMode();
    } else if (this.mode === 'edit-block') {
      const b = p.blocks.find(x => x.id === c.position.blockId); if (!b || b.locked) throw new Error('This thought is no longer editable.');
      await c.append([{ type: 'BlockPropertyEdited', payload: { block_id: b.id, property_path: 'text', old_value: this.editBase.text ?? '', new_value: this.bodyDraft } }]); this.closeMode();
    } else if (this.mode === 'rename') {
      if (!this.titleDraft.trim()) throw new Error('Give the document a name.');
      await c.append([{ type: 'DocumentRenamed', payload: { document_id: p.documentId, old_title: this.editBase.title ?? p.documentTitle, new_title: this.titleDraft.trim() } }]); this.closeMode();
    } else if (this.mode === 'intent') { c.position.intent = this.bodyDraft.trim(); this.closeMode(); return; }
    else if (this.mode === 'edit-artifact') { await c.editArtifact(c.position.outputId, this.editBase.item !== undefined ? (parseDocumentArtifactContent(c.content[p.artifacts.find(a => a.id === c.position.outputId)?.contentRef ?? ''])?.content_markdown ?? '') : this.bodyDraft, this.editBase.revision ?? 0, this.editBase.item !== undefined ? [{index:this.editBase.item,body:this.bodyDraft}] : undefined); this.closeMode(); }
    else if (this.mode === 'reuse') { const b = p.libraryBlocks.find(x => x.id === this.choice); if (!b) throw new Error('Choose a context block.'); const event = c.blockEvent(text(b.properties.text), b.handle, b.type); event.payload.properties = { ...b.properties, source_block_id: b.id, weight: .8 }; if (!c.hasUnconfirmedWrite || !this.pendingBlock) { if(this.pendingBlock) Object.assign(event.payload,{block_id:this.pendingBlock.payload.block_id,position:this.pendingBlock.payload.position}); this.pendingBlock=event; } await c.append([this.pendingBlock]); this.closeMode(); }
    this.notice = 'Saved to your creative workspace.'; this.changed(); this.decide();
  }
  private async generate() {
    const draft = this.generation; if (!draft) return;
    if (draft.format === 'scene' && !draft.scenePreview) { const quote = await this.client.previewScene(draft); if (quote) draft.scenePreview = quote; this.changed(); return; }
    if (this.generationGate) { draft.acknowledgements = { ...draft.acknowledgements, [this.generationGate.key]: true }; this.generationGate = null; }
    try { await this.client.generate(draft); this.closeMode(); this.notice = 'Your work is taking shape. You can keep exploring.'; }
    catch (error) {
      if (error instanceof ApiError && error.status === 428 && ['generation_budget_acknowledgement_required', 'generation_preflight_review_required'].includes(String(error.body.error))) {
        this.generationGate = { key: error.body.error === 'generation_budget_acknowledgement_required' ? 'budgetAcknowledged' : 'preflightAcknowledged', message: String(error.body.message ?? error.body.summary ?? 'This generation needs your review before proceeding.') };
        return;
      }
      throw error;
    }
  }
  private async exportWork() {
    const check = await this.client.verifyScope();
    const p = this.client.projection, id = this.client.position.outputId, artifact = p.artifacts.find(a => a.id === id), output = p.outputs.find(o => o.id === id);
    const model = artifact?.kind === 'model3d' ? model3dArtifactMediaFile(artifact) : null;
    const url = safeMedia(model?.url ?? artifact?.mediaUrl ?? output?.mediaUrl);
    const retained = artifact ? this.client.content[artifact.contentRef ?? ''] : '';
    const revision = artifact ? documentArtifactRevision(this.client.events, artifact.id) : 0;
    if (artifact && this.client.session?.projectContext && !retained) throw new Error('The current output content must be retained and independently approved before export.');
    const digest = retained ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(retained))), b => b.toString(16).padStart(2, '0')).join('') : '';
    check();
    await this.client.append([{ type: artifact ? 'DocumentArtifactExported' : 'ObjectExported', payload: artifact ? { artifact_id: id, artifact_kind: artifact.kind, document_id: artifact.documentId, format: model?.mimeType ?? artifact.mediaType ?? 'markdown', artifact_revision: revision, ...(digest ? {content_sha256:digest} : {}) } : { object_id: id, document_id: output?.documentId, format: output?.mediaType ?? 'image/png' } }]);
    check();
    if (id !== this.client.position.outputId || artifact && (revision !== documentArtifactRevision(this.client.events, id) || retained !== this.client.content[artifact.contentRef ?? ''])) throw new Error('The output changed before download. Reopen its current version.');
    let blob: Blob;
    if (url) { const response = await fetch(url); if (!response.ok) throw new Error('The original file is unavailable.'); blob = await response.blob(); }
    else if (artifact) { const content = parseDocumentArtifactContent(artifact.contentRef ? this.client.content[artifact.contentRef] : undefined); blob = new Blob([content?.content_markdown || artifact.items.map(i => `${i.title}\n\n${i.body}`).join('\n\n')], { type: 'text/markdown' }); }
    else throw new Error('Select a result to download.');
    await this.client.verifyScope(); check();
    const href = URL.createObjectURL(blob), a = document.createElement('a'); a.href = href; a.download = model?.fileName ?? `${artifact?.title ?? output?.title ?? 'creative-work'}.${url ? blob.type.includes('png') ? 'png' : blob.type.includes('video') ? 'mp4' : blob.type.includes('audio') ? 'mp3' : 'jpg' : 'md'}`; a.click(); setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  private prose(value: string): TemplateResult { return html`${value.split(/\n\s*\n/).map(part => /^#{1,6}\s/.test(part) ? html`<h2>${part.replace(/^#{1,6}\s*/, '')}</h2>` : html`<p>${part}</p>`)}`; }
  private renderArtifact(a: DocumentArtifact) {
    const content = parseDocumentArtifactContent(a.contentRef ? this.client.content[a.contentRef] : undefined), receipt = a.items[this.itemIndex], item = receipt ? {...receipt,...content?.items[this.itemIndex]} : undefined;
    if (a.kind === 'model3d') { const file = model3dArtifactMediaFile(a); void import('./model-view.ts'); return html`<div class="model-stage"><still-model-view src=${safeMedia(file?.url)}></still-model-view></div><p class="caption">${a.title} · Drag to explore the form</p>`; }
    if (a.kind === 'video' || a.kind === 'audio') return html`<div class=${`media-stage ${a.kind}`}>${a.kind === 'video' ? html`<video controls playsinline src=${safeMedia(a.mediaUrl ?? item?.mediaUrl)}></video>` : html`<div class="sound-form" aria-hidden="true">${Array.from({ length: 42 }, (_, i) => html`<i style=${`height:${20 + Math.abs(Math.sin(i * .7) * Math.cos(i * .23)) * 100}px`}></i>`)}</div><audio controls src=${safeMedia(a.mediaUrl ?? item?.mediaUrl)}></audio>`}<h1>${a.title}</h1>${a.summary ? html`<p>${a.summary}</p>` : nothing}</div>`;
    if ((a.kind === 'slides' || a.kind === 'storyboard') && item) return html`<article class="slide" style=${`--slide-bg:${/^#[a-f\d]{3,8}$/i.test(a.presentation?.palette.background ?? '') ? a.presentation?.palette.background : '#ede9e1'}`}><span class="eyebrow">${String(this.itemIndex + 1).padStart(2, '0')} / ${String(a.items.length).padStart(2, '0')}</span>${safeMedia(item.mediaUrl) ? html`<img src=${safeMedia(item.mediaUrl)} alt=${item.title} />` : nothing}<div><h1>${item.title}</h1><div class="prose">${this.prose(item.body)}</div></div></article>`;
    return html`<article class="writing"><span class="eyebrow">${FORMATS[a.kind] ?? 'Creative work'}</span><h1>${a.title}</h1><div class="prose">${this.prose(content?.content_markdown || a.items.map(x => `${x.title}\n\n${x.body}`).join('\n\n') || a.summary || 'The writing is not currently available.')}</div></article>`;
  }
  private renderCanvas() {
    const c = this.client, p = c.projection, pos = c.position;
    if (this.loading) return html`<section class="quiet-state"><div class="still-mark" aria-hidden="true"></div><h1>Making room.</h1><p>Opening your creative workspace…</p></section>`;
    if (!c.session) return html`<section class="quiet-state"><h1>A place for your next idea.</h1><p>Your session could not be opened.</p>${this.button('Try again', () => void this.run(async () => { await c.load(); this.readRoute(); this.decide(); }), true)}</section>`;
    if (!c.session.policy.accepted) return html`<section class="form-page"><span class="eyebrow">Before we begin</span><h1>Your work. Your terms.</h1><p>Creative context is shared with the configured generation providers and TypeSafe to support the next step. Forma’s retention and access rules apply.</p><label class="check"><input type="checkbox" .checked=${this.ownership} @change=${(e: Event) => { this.ownership = (e.target as HTMLInputElement).checked; this.changed(); }} /> I own or have permission to use the work I submit.</label><label class="check"><input type="checkbox" .checked=${this.providerConsent} @change=${(e: Event) => { this.providerConsent = (e.target as HTMLInputElement).checked; this.changed(); }} /> I approve private processing by the configured providers.</label>${this.button('Enter the workspace', () => void this.run(async () => { await c.acceptTerms(); this.readRoute(); this.decide(); }), true, !this.ownership || !this.providerConsent)}</section>`;
    if (this.mode) return this.renderMode();
    if (pos.view === 'projects' || pos.view === 'documents') {
      const projects = pos.view === 'projects', items = projects ? p.projects.map(x => ({ id: x.id, title: x.name, detail: `${x.documentCount} ${x.documentCount === 1 ? 'document' : 'documents'}` })) : p.documents.filter(d => !d.removed).map(d => ({ id: d.id, title: d.title, detail: 'Creative document' }));
      return html`<section class="library-page"><span class="eyebrow">${projects ? 'Your creative space' : p.projectName}</span><h1>${projects ? 'A little room for\nthe next idea.' : 'Pick up a thought.'}</h1><div class="work-list">${items.slice(this.page * 3, this.page * 3 + 3).map((x, i) => html`<button class="work-row" @click=${() => projects ? this.navigate('documents', { projectId: x.id, documentId: '' }) : this.navigate('document', { documentId: x.id })}><span class="work-number">${String(this.page * 3 + i + 1).padStart(2, '0')}</span><span><strong>${x.title}</strong><small>${x.detail}</small></span><span class="row-arrow" aria-hidden="true">↗</span></button>`)}</div>${!items.length ? html`<p class="empty-copy">Every project begins with something small.<br>A sentence, a question, a possibility.</p>` : nothing}</section>`;
    }
    if (pos.view === 'results') {
      const results = [...p.outputs.filter(o => !o.discarded).map(o => ({ id: o.id, title: o.title ?? 'Image', kind: 'image', url: safeMedia(o.mediaUrl), sequence: o.sequence })), ...p.artifacts.map(a => ({ id: a.id, title: a.title, kind: a.kind, url: '', sequence: a.sequence }))].sort((a, b) => b.sequence - a.sequence);
      return html`<section class="results-page"><span class="eyebrow">${p.documentTitle}</span><h1>See where it went.</h1><div class="result-grid">${results.slice(this.page * 3, this.page * 3 + 3).map(r => html`<button class="result" @click=${() => this.navigate('artifact', { outputId: r.id })}>${r.url ? html`<img src=${r.url} alt=${r.title} />` : html`<div class="result-word">${FORMATS[r.kind]}</div>`}<span>${r.title}</span></button>`)}</div>${!results.length ? html`<p>Your first result will appear here.</p>` : nothing}</section>`;
    }
    if (pos.view === 'artifact') {
      const a = p.artifacts.find(x => x.id === pos.outputId), o = p.outputs.find(x => x.id === pos.outputId);
      return a ? this.renderArtifact(a) : o ? html`<figure class="image-stage"><img src=${safeMedia(o.mediaUrl)} alt=${o.title ?? p.documentTitle} /><figcaption>${o.title ?? p.documentTitle}</figcaption></figure>` : html`<section class="quiet-state"><h1>This work is unavailable.</h1><p>Return to the document to choose another result.</p></section>`;
    }
    return html`<article class="document-page"><span class="eyebrow">${p.projectName}</span><h1>${p.documentTitle}</h1><div class="context-blocks">${p.blocks.filter(b => !b.removed).map((b, i) => html`<button aria-pressed=${String(pos.blockId === b.id)} class=${`context-block ${pos.blockId === b.id ? 'selected' : ''} ${Number(b.properties.weight ?? 1) <= 0 ? 'inactive' : ''}`} @click=${() => { pos.blockId = pos.blockId === b.id ? '' : b.id; this.changed(); this.decide(); }}><span class="block-index">${String(i + 1).padStart(2, '0')}</span><div><span class="block-label">${b.handle || b.type}${b.locked ? ' · held constant' : ''}${Number(b.properties.weight ?? 1) <= 0 ? ' · set aside' : ''}</span><p>${text(b.properties.text) || text(b.properties.description) || 'Select this context to explore it.'}</p></div></button>`)}</div>${!p.blocks.filter(b => !b.removed).length ? html`<div class="blank-page"><span class="pencil-line" aria-hidden="true"></span><p>What is the first thing<br>you want this to be?</p></div>` : nothing}</article>`;
  }
  private renderMode() {
    const mode = this.mode, p = this.client.projection;
    if (mode === 'generate' && this.generation) {
      const g = this.generation;
      return html`<section class="form-page generation-page"><span class="eyebrow">${p.documentTitle}</span><h1>${FORMATS[g.format]}.<br>A new way to see it.</h1><p>${g.format === 'model3d' ? 'Review the exact description sent to the 3D generator.' : 'Your active context will guide this version. Existing work stays available.'}</p>${g.format === 'model3d' ? this.field('Description · up to 1,024 characters', g.prompt, v => { g.prompt = v; }, 6) : html`<div class="generation-context">${p.blocks.filter(b => !b.removed && Number(b.properties.weight ?? 1) > 0).slice(0, 3).map(b => html`<p><span>${b.handle}</span>${text(b.properties.text).slice(0, 220)}</p>`)}</div>`}${['slides', 'storyboard'].includes(g.format) ? html`<label class="select-label">Length<select .value=${String(g.itemCount)} @change=${(e: Event) => { g.itemCount = Number((e.target as HTMLSelectElement).value); this.changed(); }}>${[3, 4, 6, 8, 10].map(n => html`<option value=${n}>${n} ${g.format === 'slides' ? 'slides' : 'frames'}</option>`)}</select></label>` : nothing}${!['model3d', 'image'].includes(g.format) ? this.field('Tone or atmosphere', g.tone, v => { g.tone = v; g.scenePreview = undefined; }, 1, 'Optional') : nothing}${g.adaptation?.omittedBlockIds.length ? html`<p class="cost-note">The 3D description omits ${g.adaptation.omittedBlockIds.length} context blocks to fit the provider limit. Review it before generating.</p>` : nothing}${g.adaptation?.issues.map(i => html`<p class="gate-notice">${i.message}</p>`)}<p class="cost-note">${g.format === 'model3d' ? `Estimated generation cost: $${(estimateModel3dCostMicrousd() / 1e6).toFixed(2)} · GLB · text to 3D` : g.scenePreview ? `Maximum scene generation cost: $${(g.scenePreview.maximumMicrousd / 1e6).toFixed(2)} · ${g.scenePreview.model}` : g.format === 'scene' ? 'Check the current scene cost before approving generation.' : 'Generation uses your existing Forma provider and spending limits.'}</p>${this.generationGate ? html`<p class="gate-notice">${this.generationGate.message}</p>` : nothing}<div class="form-actions">${this.button(g.format === 'scene' && !g.scenePreview ? 'Check cost' : g.attempted ? 'Check original generation' : this.generationGate ? 'Approve and continue' : 'Generate this version', () => void this.run(() => this.generate()), true)}${this.button('Back', () => this.closeMode())}</div></section>`;
    }
    if (mode === 'actions') return html`<section class="form-page"><span class="eyebrow">Another possibility</span><h1>Where to next?</h1><label class="select-label">Choose a direction<select .value=${this.choice} @change=${(e: Event) => { this.choice = (e.target as HTMLSelectElement).value; this.changed(); }}>${this.candidates().map(a => html`<option value=${a.id}>${a.label}</option>`)}</select></label><div class="form-actions">${this.button('Go', () => this.choose(this.choice), true)}${this.button('Workspaces', () => { this.mode = 'workspaces'; this.changed(); })}${this.button('Refresh', () => void this.run(async () => { await this.client.load(); this.readRoute(); this.closeMode(); }))}${this.button('Back', () => this.closeMode())}</div></section>`;
    if (mode === 'workspaces') return html`<section class="form-page"><h1>A shared space.</h1><label class="select-label">Workspace<select .value=${this.choice} @change=${(e: Event) => { this.choice = (e.target as HTMLSelectElement).value; this.changed(); }}><option value="">Personal projects</option>${this.client.session?.projects?.map(p => html`<option value=${p.projectAccessId}>${p.projectName} · ${p.role}</option>`)}</select></label><div class="form-actions">${this.button('Open workspace', () => void this.run(async () => { await this.client.switchWorkspace(this.client.session?.projects?.find(p => p.projectAccessId === this.choice)); this.navigate(this.client.position.view, this.client.position); }), true)}${this.button('Back', () => this.closeMode())}</div></section>`;
    if (mode === 'reuse') return html`<section class="form-page"><span class="eyebrow">A useful connection</span><h1>Bring an idea along.</h1><label class="select-label">Context from this project<select .value=${this.choice} @change=${(e: Event) => { this.choice = (e.target as HTMLSelectElement).value; this.changed(); }}><option value="">Choose a thought</option>${p.libraryBlocks.filter(b => !b.removed && b.documentId !== p.documentId).map(b => html`<option value=${b.id}>${b.handle} · ${b.type}</option>`)}</select></label><p class="context-preview">${text(p.libraryBlocks.find(b => b.id === this.choice)?.properties.text)}</p><div class="form-actions">${this.button('Use this context', () => void this.run(() => this.save()), true, !this.choice)}${this.button('Back', () => this.closeMode())}</div></section>`;
    const titles: Record<string, string> = { 'new-project': 'Something begins here.', 'new-document': 'A fresh page.', 'add-context': 'Give the idea some shape.', 'edit-block': 'A thought, refined.', rename: 'What shall we call it?', intent: 'Follow your thought.', 'edit-artifact': 'Make it yours.' };
    const named = ['new-project', 'new-document', 'add-context', 'rename'].includes(mode);
    return html`<section class="form-page"><span class="eyebrow">${mode === 'intent' ? 'A little guidance' : p.projectName}</span><h1>${titles[mode] ?? 'A new direction.'}</h1>${mode === 'intent' ? html`<p>Describe where you want to go. The next actions will respond to your thought.</p>` : nothing}${named ? this.field(mode === 'add-context' ? 'Name this thought' : 'Name', this.titleDraft, v => { this.titleDraft = v; }, 1, 'A working title is enough') : nothing}${mode === 'add-context' ? html`<label class="select-label">Kind of context<select .value=${this.kindDraft} @change=${(e: Event) => { this.kindDraft = (e.target as HTMLSelectElement).value; }}>${blockKinds.map(k => html`<option value=${k}>${k[0].toUpperCase() + k.slice(1)}</option>`)}</select></label>` : nothing}${mode !== 'rename' ? this.field(mode === 'intent' ? 'What is on your mind?' : mode === 'edit-artifact' ? 'Your writing' : 'The idea', this.bodyDraft, v => { this.bodyDraft = v; }, mode === 'edit-artifact' ? 16 : 6, mode === 'add-context' && this.titleDraft === 'Another possibility' ? 'What if the scale, the setting, or the point of view changed?' : 'Start anywhere. A sentence is enough.') : nothing}<div class="form-actions">${this.button(mode === 'intent' ? 'Find my next step' : this.client.hasUnconfirmedWrite ? 'Check the original save' : 'Save this thought', () => void this.run(() => this.save()), true)}${this.button('Back', () => this.closeMode())}</div></section>`;
  }
  private renderDock() {
    const c = this.client, p = c.projection, view = c.position.view;
    if (this.loading || !c.session?.policy.accepted || this.mode) return nothing;
    let actions: TemplateResult[];
    if (view === 'projects' || view === 'documents' || view === 'results') {
      const count = view === 'projects' ? p.projects.length : view === 'documents' ? p.documents.filter(d => !d.removed).length : p.outputs.filter(o => !o.discarded).length + p.artifacts.length;
      const suggested = this.suggestions.find(a => a.id !== view && a.id !== 'results');
      actions = suggested ? [this.button(suggested.label, () => this.choose(suggested.id), true)] : [this.button(view === 'projects' ? 'Begin something' : view === 'documents' ? 'A fresh page' : 'Return to the idea', () => view === 'results' ? this.navigate('document') : this.begin(view === 'projects' ? 'new-project' : 'new-document'), true, view === 'projects' ? !c.abilities.projectCreate : view !== 'results' && !c.abilities.author)];
      if (count > 3) actions = [this.button(this.page > 0 ? 'Previous' : 'First page', () => { this.page = Math.max(0, this.page - 1); this.changed(); }, false, this.page === 0), this.button('Next', () => { ++this.page; this.changed(); }, false, (this.page + 1) * 3 >= count)];
      // The browse content contains at most three item controls; the dock adds two.
      if (actions.length === 2) actions = [this.button('More work', () => { this.page = (this.page + 1) * 3 >= count ? 0 : this.page + 1; this.changed(); })];
      actions.push(this.button('Something else', () => this.begin('actions')));
    } else {
      const a = p.artifacts.find(x => x.id === c.position.outputId);
      if (view === 'artifact' && a && ['slides', 'storyboard'].includes(a.kind) && a.items.length > 1) actions = [this.button('Previous', () => { --this.itemIndex; this.changed(); this.decide(); }, false, this.itemIndex === 0), this.button('Next', () => { ++this.itemIndex; this.changed(); this.decide(); }, false, this.itemIndex >= a.items.length - 1), ...this.suggestions.slice(0,2).map(a => this.button(a.label, () => this.choose(a.id))), this.button('Something else', () => this.begin('actions'))];
      else actions = [html`${repeat(this.suggestions.slice(0, 4), a => a.id, (a, i) => this.button(a.label, () => this.choose(a.id), i === 0))}`, this.button('Something else', () => this.begin('actions'))];
    }
    return html`<footer class="action-dock"><span class="dock-caption">${this.busy ? 'A moment…' : this.decisionSource === 'jev' ? 'A few ways forward, for you' : 'A few ways forward'}</span><en-toolbar label="Your next step" keyboard-navigation="tab">${actions}</en-toolbar></footer>`;
  }
  render() {
    const c = this.client, p = c.projection, running = c.jobs.filter(j => activeJobs.has(j.status) && j.documentId === c.position.documentId), failed = c.jobs.find(j => j.status === 'failed' && j.documentId === c.position.documentId);
    return html`<div class="still-shell"><header class="masthead"><span class="wordmark">still<span aria-hidden="true">.</span></span><span class="location-label">${this.mode ? 'One thought at a time' : c.position.projectId ? p.projectName : 'Room to make'}</span><span class="session-status">${this.busy ? 'Working' : c.session?.impersonation ? 'Fictional account · read only' : c.session && !c.abilities.author ? 'Read only' : 'Your creative space'}</span></header><main id="still-content" aria-busy=${this.loading}>${this.renderCanvas()}</main>${running.length ? html`<aside class="job-status" role="status"><i></i>${running[0].progressMessage || 'Your generation is in progress'}${running.length > 1 ? ` · ${running.length} in progress` : ''}</aside>` : nothing}${this.error || failed && !this.mode ? html`<div class="status-message error" role="alert">${this.error || failed?.errorDetail?.message || failed?.error || 'The generation could not finish.'}</div>` : this.notice && !this.mode ? html`<div class="status-message" role="status">${this.notice}</div>` : nothing}${this.renderDock()}${new URL(location.href).searchParams.has('progress-report') ? html`<a class="progress-return" href=${REPORT_URL}>Progress Report ↗</a>` : nothing}</div>`;
  }
}
if (!customElements.get('still-app')) customElements.define('still-app', StillApp);
