import { LitElement, html, nothing, type PropertyValues } from 'lit';
import { ensureVideoCover } from '../media/video-cover.ts';
import './video-cover.css';

/** Display a saved WebP cover for a video.
 * @summary Display a saved WebP cover for a video.
 */
export class FormaVideoCover extends LitElement {
  static properties = { source: {}, label: {}, eager: { type: Boolean }, image: { state: true } };
  source = ''; label = ''; eager = false;
  private image = '';
  private observer?: IntersectionObserver;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private attempts = 0;
  protected override createRenderRoot() { return this; }
  override connectedCallback() { super.connectedCallback(); this.start(); }
  override disconnectedCallback() { super.disconnectedCallback(); this.reset(); }
  protected override updated(changes: PropertyValues) {
    if (changes.has('source') || changes.has('eager')) { this.reset(); this.start(); }
  }
  private reset() {
    this.generation++; this.attempts = 0; this.observer?.disconnect(); clearTimeout(this.retryTimer);
    if (this.image) URL.revokeObjectURL(this.image); this.image = '';
  }
  private start() {
    if (!this.isConnected || !this.source) return;
    if (this.eager || typeof IntersectionObserver === 'undefined') { void this.load(); return; }
    this.observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { this.observer?.disconnect(); void this.load(); }
    }, { rootMargin: '200px' });
    this.observer.observe(this);
  }
  private async load() {
    const generation = this.generation; this.attempts++;
    const result = await ensureVideoCover(this.source);
    if (!this.isConnected || generation !== this.generation) return;
    if (result.blob) { this.image = URL.createObjectURL(result.blob); return; }
    if (result.retry && this.attempts < 3) this.retryTimer = setTimeout(() => { void this.load(); }, this.attempts * 5000);
  }
  protected override render() {
    return this.image ? html`<img src=${this.image} alt=${this.label} decoding="async" />`
      : html`<span class="video-cover-placeholder" role="img" aria-label=${this.label || nothing}><svg viewBox="0 0 24 24" aria-hidden="true" width="32" height="32"><path d="m9 5 11 7-11 7z" fill="currentColor" /></svg></span>`;
  }
}
if (!customElements.get('forma-video-cover')) customElements.define('forma-video-cover', FormaVideoCover);
declare global { interface HTMLElementTagNameMap { 'forma-video-cover': FormaVideoCover; } }
