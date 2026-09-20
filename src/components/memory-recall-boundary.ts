import { memoryPrivacyMutationActive } from '../state/memory-privacy-mutation.ts';
import './memory-recall-boundary.css';
import { html, nothing } from 'lit';
import { FormaElement } from './forma-element.ts';
import { createRecallBoundaryClient, type RecallBoundaryView, type RecallSource } from '../state/memory-recall-boundary-client.ts';
import { MEMORY_RECALL_BOUNDARIES, type MemoryRecallBoundary } from '../model/memory-recall-boundary.ts';
import { MEMORY_DERIVATION_PURPOSES, type MemoryDerivationPurpose } from '../model/memory-derivation-policy.ts';
import { createMemoryElapsed } from '../model/memory-lifetime.ts';
import { personalMemoryMessage } from './design-system/locales/personal-memory-messages.ts';
import type { MemoryEnrollment } from '../state/live-memory-client.ts';

type Client = ReturnType<typeof createRecallBoundaryClient>;
type Preview = Awaited<ReturnType<Client['inspect']>>;
// Explicit native controls and private preview; no prompts, authored edits or persistence.
export class MemoryRecallBoundaryControl extends FormaElement {
  static properties = { enrollment: { attribute: false }, currentCheck: { attribute: false } };
  declare enrollment: MemoryEnrollment | undefined;
  declare currentCheck: (() => boolean) | undefined;
  #view: RecallBoundaryView | null = null;
  #sources: RecallSource[] = [];
  #preview: Preview | null = null;
  #boundary: MemoryRecallBoundary = 'document';
  #purpose: MemoryDerivationPurpose = 'rolling-summary';
  #source = '';
  #consent = false;
  #busy = false;
  #status = '';
  #lease: { mutation: boolean; current: () => boolean; controller: AbortController; until: number } | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #t(key: string) { return personalMemoryMessage(this.i18n.locale, 'memory.live.' + key); }
  #clear = () => { this.#lease?.controller.abort(); this.#lease = null; clearTimeout(this.#timer); this.#timer = undefined;
    this.#view = null; this.#sources = []; this.#preview = null; this.#source = ''; this.#consent = false; this.#busy = false; this.requestUpdate(); };
  #privacy = () => { if (!this.#lease?.mutation && memoryPrivacyMutationActive()) this.#hide(); };
  #hide = () => { this.#status = this.#busy ? 'recallBoundaryUncertain' : 'briefExpired'; this.#clear(); };
  #expire = () => {
    const focused = this.ownerDocument.activeElement, stamp = JSON.stringify(this.enrollment);
    const restore = this.isConnected && this.ownerDocument.visibilityState === 'visible' && this.currentCheck?.() && focused && this.contains(focused);
    this.#hide();
    if (restore) void this.updateComplete.then(() => {
      if (this.isConnected && this.currentCheck?.() && this.ownerDocument.visibilityState === 'visible' && JSON.stringify(this.enrollment) === stamp
        && (!this.ownerDocument.activeElement || this.ownerDocument.activeElement === this.ownerDocument.body || this.ownerDocument.activeElement === focused))
        this.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    });
  };
  #visibility = () => { if (this.ownerDocument.visibilityState !== 'visible') this.#hide(); };
  override connectedCallback() { super.connectedCallback(); window.addEventListener('pagehide', this.#hide); window.addEventListener('blur', this.#hide); window.addEventListener('forma-memory-privacy-mutation', this.#privacy); this.ownerDocument.addEventListener('visibilitychange', this.#visibility); }
  override disconnectedCallback() { this.#clear(); window.removeEventListener('pagehide', this.#hide); window.removeEventListener('blur', this.#hide); window.removeEventListener('forma-memory-privacy-mutation', this.#privacy); this.ownerDocument.removeEventListener('visibilitychange', this.#visibility); super.disconnectedCallback(); }
  protected override updated() { if (this.#lease && !this.#lease.current()) this.#hide(); }
  #active() { if (this.#lease && !this.#lease.current()) { this.#hide(); return false; } return Boolean(this.#lease); }
  async #run(action: 'load' | 'save' | 'reset' | 'sources' | 'inspect') {
    if (this.#busy || memoryPrivacyMutationActive() || !this.enrollment || !this.currentCheck?.() || this.ownerDocument.visibilityState !== 'visible') return;
    const row = this.enrollment, scope = { projectId: row.projectId, documentId: row.documentId }, view = this.#view,
      boundary = this.#boundary, chosen = this.#sources.find(s => s.enrollmentId === this.#source), purpose = this.#purpose;
    if (action === 'save' && (!this.#active() || !view || !this.#consent) || action === 'inspect' && (!this.#active() || !chosen)) return;
    this.#clear(); this.#busy = true; this.#status = '';
    const store = this.store, auth = store.captureAuthorizationScope(), source = store.captureSourceOwnership(), route = store.route.get(),
      locale = this.i18n.locale, stamp = JSON.stringify(row), started = Date.now(), elapsed = createMemoryElapsed({ wall: started, monotonic: performance.now() }), controller = new AbortController();
    const owner = { mutation: action === 'save' || action === 'reset', controller, until: started + 30000, current: () => this.#lease === owner && (owner.mutation || !memoryPrivacyMutationActive()) && !controller.signal.aborted && this.isConnected
      && this.ownerDocument.visibilityState === 'visible' && this.currentCheck?.() === true && this.store === store && this.i18n.locale === locale
      && store.route.get() === route && store.authorizationScopeActive(auth) && store.sourceOwnershipActive(source)
      && JSON.stringify(this.enrollment) === stamp && Date.now() < owner.until && elapsed.elapsed({ wall: Date.now(), monotonic: performance.now() }) < owner.until - started };
    this.#lease = owner; this.#timer = setTimeout(this.#expire, 30000); this.requestUpdate();
    const client = createRecallBoundaryClient((input, init) => { if (!owner.current()) throw Error('recall_owner'); return store.guardedFetch(input, init, this.#t('recallBoundaryHeading'), { current: owner.current }); });
    try {
      if (action === 'load') { const value = await client.boundary(scope, controller.signal); if (!owner.current()) return;
        if (value.enrollmentId !== row.id || value.enrollmentRevision !== row.revision) throw Error('recall_enrollment');
        this.#view = value; this.#boundary = value.boundary; owner.until = Math.min(owner.until, Date.parse(value.validUntil)); }
      if (action === 'save') { await client.save(scope, view!, boundary, controller.signal); if (!owner.current()) return; this.#status = 'recallBoundarySaved'; }
      if (action === 'reset') { await client.reset(scope, controller.signal); if (!owner.current()) return; this.#status = 'recallBoundarySaved'; }
      if (action === 'sources') { const value = await client.sources(scope, controller.signal); if (!owner.current()) return;
        this.#sources = value.sources; this.#source = value.sources[0]?.enrollmentId ?? ''; owner.until = Math.min(owner.until, Date.parse(value.validUntil));
        if (!value.sources.length) this.#status = 'recallBoundaryEmpty'; }
      if (action === 'inspect') { const value = await client.inspect(scope, chosen!, purpose, controller.signal); if (!owner.current()) return;
        this.#preview = value; owner.until = Math.min(owner.until, Date.parse(value.validUntil)); }
      clearTimeout(this.#timer); this.#timer = setTimeout(this.#expire, Math.max(0, owner.until - Date.now()));
    } catch { if (owner.current()) this.#status = action === 'save' || action === 'reset' ? 'recallBoundaryUncertain' : 'recallBoundaryUnavailable'; }
    finally { if (this.#lease === owner) { this.#busy = false; this.requestUpdate(); } }
  }
  override render() {
    if (!this.enrollment || !this.currentCheck?.()) return nothing;
    const active = this.#active(), view = active ? this.#view : null, preview = active ? this.#preview : null;
    return html`<section data-memory-recall-boundary>
      <h3>${this.#t('recallBoundaryHeading')}</h3><p>${this.#t('recallBoundaryHelp')}</p>
      <div class="memory-actions"><button type="button" class="button secondary" ?disabled=${this.#busy} @click=${() => this.#run('load')}>${this.#t('recallBoundaryLoad')}</button>
        <button type="button" class="button secondary" ?disabled=${this.#busy} @click=${() => this.#run('sources')}>${this.#t('recallBoundarySources')}</button>
        <button type="button" class="button ghost" ?disabled=${this.#busy} @click=${() => this.#run('reset')}>${this.#t('recallBoundaryReset')}</button></div>
      ${view ? html`<label>${this.#t('recallBoundaryRange')} <select .value=${this.#boundary} @change=${(e: Event) => { this.#boundary = (e.target as HTMLSelectElement).value as MemoryRecallBoundary; this.#consent = false; this.requestUpdate(); }}>${MEMORY_RECALL_BOUNDARIES.map(b => html`<option value=${b} ?selected=${b === this.#boundary}>${this.#t('recallBoundary.' + b)}</option>`)}</select></label>
        <label><input type="checkbox" .checked=${this.#consent} @change=${(e: Event) => { this.#consent = (e.target as HTMLInputElement).checked; this.requestUpdate(); }}>${this.#t('recallBoundaryConsent')}</label>
        <button type="button" class="button primary" ?disabled=${!this.#consent || this.#busy} @click=${() => this.#run('save')}>${this.#t('recallBoundarySave')}</button>` : nothing}
      ${active && this.#sources.length ? html`<label>${this.#t('recallBoundarySource')} <select .value=${this.#source} @change=${(e: Event) => { this.#source = (e.target as HTMLSelectElement).value; this.requestUpdate(); }}>${this.#sources.map(s => html`<option value=${s.enrollmentId} ?selected=${s.enrollmentId === this.#source}>${s.documentId} · ${this.#t('recallBoundary.' + s.zoom)}</option>`)}</select></label>
        <label>${this.#t('recallBoundaryPurpose')} <select .value=${this.#purpose} @change=${(e: Event) => { this.#purpose = (e.target as HTMLSelectElement).value as MemoryDerivationPurpose; this.requestUpdate(); }}>${MEMORY_DERIVATION_PURPOSES.map(p => html`<option value=${p} ?selected=${p === this.#purpose}>${this.#t('purpose.' + p)}</option>`)}</select></label>
        <button type="button" class="button secondary" ?disabled=${this.#busy} @click=${() => this.#run('inspect')}>${this.#t('reviewInspect')}</button>` : nothing}
      ${preview ? html`<p>${preview.source.documentId} · ${this.#t('recallBoundary.' + preview.source.zoom)}</p><p>${this.#t('recallBoundaryPreview')}</p>
        <ul>${preview.items.map(item => html`<li><p>${item.text}</p>${item.citationStatus === 'conflicting-citations' ? html`<strong>${this.#t('briefConflict')}</strong>` : nothing}
          <details><summary>${this.#t('briefEvidence')}</summary>${item.supports.map(q => html`<blockquote>${q.text}</blockquote>`)}
          ${item.counterevidence.length ? html`<p>${this.#t('briefCounterevidence')}</p>${item.counterevidence.map(q => html`<blockquote>${q.text}</blockquote>`)}` : nothing}
          ${item.observationCitations?.length ? html`<p>${this.#t('behavioralDisclosure')}</p><ul>${item.observationCitations.map(c => html`<li>${this.#t('behavioralRole.' + c.role)}: ${this.#t('behavioralAction.' + c.action)}</li>`)}</ul>` : nothing}</details></li>`)}</ul>` : nothing}
      ${this.#status ? html`<p role="status">${this.#t(this.#status)}</p>` : nothing}
    </section>`;
  }
}
if (!customElements.get('forma-memory-recall-boundary')) customElements.define('forma-memory-recall-boundary', MemoryRecallBoundaryControl);
